import { inspectApkBlob, listApkEntries } from './apk';
import { sha256Hex } from './keys';
import type { FileMap } from './vfs';

export interface Out {
  text: string;
  tone?: 'info' | 'ok' | 'warn' | 'err' | 'muted' | 'cmd';
}

export interface ShellHost {
  files: FileMap;
  cwd: string;
  setCwd(path: string): void;
  env: Record<string, string>;
  write(patch: Record<string, string>): void;
  remove(paths: string[]): void;
  exists(path: string): boolean;
  runGradle(task: string): Promise<void>;
  runMaven(goal: string): Promise<void>;
  openFile(path: string): void;
  openAssistant(prompt?: string): void;
  openDocs(): void;
  openDeliver(): void;
  installLastApk(): void;
  artifacts(): { name: string; size: number; sha256?: string; blob: Blob }[];
  keySummary(): { debug: string; release: string };
  clearScreen(): void;
  history(): string[];
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function resolve(cwd: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  if (!target) return cwd;
  const base = target.startsWith('./') ? `${cwd}/${target.slice(2)}` : cwd ? `${cwd}/${target}` : target;
  const parts: string[] = [];
  for (const segment of base.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function pickApkArtifact(
  artifacts: { name: string; size: number; sha256?: string; blob: Blob }[],
  explicitTarget?: string,
): { artifact: { name: string; size: number; sha256?: string; blob: Blob } | null; error?: string } {
  if (!artifacts.length) {
    return { artifact: null, error: 'no APK built yet — run `gradle assembleDebug` or `gradle assembleRelease` first' };
  }
  if (!explicitTarget) {
    return { artifact: artifacts[0] };
  }
  const baseName = explicitTarget.split('/').pop() ?? explicitTarget;
  const found = artifacts.find(
    (a) =>
      a.name === baseName ||
      explicitTarget.endsWith(a.name) ||
      (baseName === 'app-debug.apk' && a.name.endsWith('-debug.apk')) ||
      (baseName === 'app-release.apk' && a.name.endsWith('-release.apk')),
  );
  if (!found) {
    return { artifact: null, error: `cannot open '${explicitTarget}': No such built APK (${artifacts.map((a) => a.name).join(', ')})` };
  }
  return { artifact: found };
}

const GRADLE_TASKS = [
  'assembleDebug   - Assembles the debug APK (v1 + v2 signed)',
  'assembleRelease - Assembles the signed release APK (v1 + v2 signed)',
  'build           - Assembles both variants, runs unit tests & lint',
  'clean           - Deletes app/build and target directories',
  'lint            - Runs Android lint checks',
  'test            - Runs the unit test suite',
];

export async function runCommand(host: ShellHost, line: string): Promise<Out[]> {
  const out: Out[] = [];
  const push = (text: string, tone: Out['tone'] = 'info') => out.push({ text, tone });
  const tokens = tokenize(line.trim());
  if (!tokens.length) return out;
  const cmd = tokens[0];
  const args = tokens.slice(1);
  const cwd = host.cwd;

  const listDir = (dir: string): string[] => {
    const prefix = dir ? `${dir}/` : '';
    const names = new Set<string>();
    for (const path of Object.keys(host.files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      names.add(slash >= 0 ? rest.slice(0, slash) + '/' : rest);
    }
    return Array.from(names).sort();
  };

  switch (cmd) {
    case 'help':
      push('APKForge Studio shell', 'ok');
      push('');
      push('Files      ls cd pwd cat head tail tree find grep touch mkdir rm cp mv echo wc sha256sum', 'muted');
      push('Build      gradle mvn keytool apksigner zipalign unzip', 'muted');
      push('Device     adb emulator sdkmanager avdmanager appetizer', 'muted');
      push('Assistant  opencode', 'muted');
      push('Delivery   deliver docs', 'muted');
      push('');
      push('Gradle tasks:', 'muted');
      GRADLE_TASKS.forEach((t) => push('  ' + t, 'muted'));
      return out;

    case 'pwd':
      push('/' + cwd);
      return out;

    case 'ls': {
      const long = args.includes('-l') || args.includes('-la');
      const target = resolve(cwd, args.find((a) => !a.startsWith('-')) ?? '');
      const names = listDir(target);
      if (!names.length) {
        if (target && host.files[target] !== undefined) {
          push(target.split('/').pop() ?? target);
          return out;
        }
        push(`ls: cannot access '${target || '.'}': No such directory`, 'err');
        return out;
      }
      if (long) {
        names.forEach((name) => {
          const isDir = name.endsWith('/');
          const path = `${target ? target + '/' : ''}${name.replace(/\/$/, '')}`;
          const content = host.files[path];
          const size = content !== undefined ? content.length : 4096;
          push(`${isDir ? 'drwxr-xr-x' : '-rw-r--r--'} 1 forge forge ${String(size).padStart(8)} ${name}`, 'muted');
        });
      } else {
        push(names.join('   '));
      }
      return out;
    }

    case 'cd': {
      const target = resolve(cwd, args[0] ?? '');
      if (target && !listDir(target).length && host.files[target] === undefined) {
        push(`cd: ${args[0]}: No such file or directory`, 'err');
        return out;
      }
      host.env.PWD = '/' + target;
      host.setCwd(target);
      return out;
    }

    case 'cat': {
      if (!args.length) return out;
      const path = resolve(cwd, args[0]);
      const content = host.files[path];
      if (content === undefined) {
        push(`cat: ${args[0]}: No such file`, 'err');
        return out;
      }
      content.split('\n').forEach((l) => push(l));
      return out;
    }

    case 'head':
    case 'tail': {
      const path = resolve(cwd, args[0] ?? '');
      const content = host.files[path];
      if (content === undefined) {
        push(`${cmd}: ${args[0]}: No such file`, 'err');
        return out;
      }
      const lines = content.split('\n');
      const picked = cmd === 'head' ? lines.slice(0, 10) : lines.slice(-10);
      picked.forEach((l) => push(l));
      return out;
    }

    case 'tree': {
      const walk = (dir: string, prefix: string) => {
        const names = listDir(dir);
        names.forEach((name, i) => {
          const last = i === names.length - 1;
          const isDir = name.endsWith('/');
          push(`${prefix}${last ? '└── ' : '├── '}${name}`, isDir ? 'muted' : 'info');
          if (isDir) walk(`${dir ? dir + '/' : ''}${name.replace(/\/$/, '')}`, `${prefix}${last ? '    ' : '│   '}`);
        });
      };
      push('.', 'ok');
      walk(cwd, '');
      return out;
    }

    case 'find': {
      const needle = (args[0] ?? '').replace(/^\*\*/, '').replace(/\*\*$/, '');
      Object.keys(host.files)
        .filter((p) => p.includes(needle))
        .forEach((p) => push(p));
      return out;
    }

    case 'grep': {
      const nonFlags = args.filter((a) => !a.startsWith('-'));
      const needle = nonFlags[0] ?? '';
      if (!needle) return out;
      const recursive = args.includes('-r');
      const pattern = nonFlags.slice(1);
      const targets = pattern.length ? pattern : Object.keys(host.files);
      targets.forEach((target) => {
        const path = resolve(cwd, target);
        const content = host.files[path];
        if (content === undefined) {
          if (recursive) {
            Object.keys(host.files)
              .filter((p) => p.startsWith(path ? path + '/' : ''))
              .forEach((p) => {
                host.files[p].split('\n').forEach((l, i) => {
                  if (l.includes(needle)) push(`${p}:${i + 1}: ${l.trim()}`, 'ok');
                });
              });
          }
          return;
        }
        content.split('\n').forEach((l, i) => {
          if (l.includes(needle)) push(`${target}:${i + 1}: ${l.trim()}`, 'ok');
        });
      });
      return out;
    }

    case 'wc': {
      const path = resolve(cwd, args[0] ?? '');
      const content = host.files[path];
      if (content === undefined) {
        push(`wc: ${args[0] ?? ''}: No such file`, 'err');
        return out;
      }
      push(`${content.split('\n').length} ${content.split(/\s+/).filter(Boolean).length} ${content.length} ${args[0]}`);
      return out;
    }

    case 'touch': {
      const patch: Record<string, string> = {};
      args.forEach((a) => {
        const path = resolve(cwd, a);
        patch[path] = host.files[path] ?? '';
      });
      host.write(patch);
      return out;
    }

    case 'mkdir': {
      const patch: Record<string, string> = {};
      args
        .filter((a) => !a.startsWith('-'))
        .forEach((a) => {
          patch[`${resolve(cwd, a)}/.keep`] = '';
        });
      host.write(patch);
      return out;
    }

    case 'rm': {
      const targets = args.filter((a) => !a.startsWith('-'));
      const paths: string[] = [];
      targets.forEach((t) => {
        const path = resolve(cwd, t);
        if (host.files[path] !== undefined) paths.push(path);
        else
          Object.keys(host.files)
            .filter((p) => p.startsWith(path + '/'))
            .forEach((p) => paths.push(p));
      });
      host.remove(paths);
      return out;
    }

    case 'cp': {
      const [from, to] = args;
      if (!from || !to) return out;
      const content = host.files[resolve(cwd, from)];
      if (content === undefined) {
        push(`cp: ${from}: No such file`, 'err');
        return out;
      }
      host.write({ [resolve(cwd, to)]: content });
      return out;
    }

    case 'mv': {
      const [from, to] = args;
      if (!from || !to) return out;
      const source = resolve(cwd, from);
      const content = host.files[source];
      if (content === undefined) {
        push(`mv: ${from}: No such file`, 'err');
        return out;
      }
      host.write({ [resolve(cwd, to)]: content });
      host.remove([source]);
      return out;
    }

    case 'echo':
      push(args.join(' '));
      return out;

    case 'export': {
      const [assignment] = args;
      if (assignment?.includes('=')) {
        const [k, ...rest] = assignment.split('=');
        host.env[k] = rest.join('=');
      }
      return out;
    }

    case 'env':
      Object.entries(host.env).forEach(([k, v]) => push(`${k}=${v}`, 'muted'));
      return out;

    case 'history':
      host.history().forEach((h, i) => push(`${String(i + 1).padStart(4)}  ${h}`, 'muted'));
      return out;

    case 'clear':
      host.clearScreen();
      return out;

    case 'date':
      push(new Date().toString());
      return out;

    case 'whoami':
      push('forge');
      return out;

    case 'uname':
      push(args.includes('-a') ? 'Linux apkforge-browser 6.6.0 WebCrypto/AXML/DEX035' : 'Linux');
      return out;

    case 'which':
      push(`/usr/local/bin/${args[0] ?? ''}`);
      return out;

    case 'java':
    case 'javac':
    case 'kotlinc':
    case 'wasm64':
      push('APKForge Browser Compiler Pipeline:', 'ok');
      push('  manifest  : Binary AXML (0x00080003) compiler', 'muted');
      push('  resources : Uncompressed 4-byte aligned ResTable (resources.arsc)', 'muted');
      push('  bytecode  : Dalvik DEX 035 assembler (MainActivity + WebView Bridge)', 'muted');
      push('  signing   : WebCrypto RSA-2048 JAR v1 + APK Signature Scheme v2', 'muted');
      push('  note      : Arbitrary native javac/kotlinc compilation requires a local JDK 17 + Android SDK 34.', 'muted');
      return out;

    case 'gradle':
    case './gradlew': {
      if (args.includes('-v') || args.includes('--version')) {
        push('APKForge Gradle Runner (compatible with Gradle 8.7 / AGP 8.5.2)', 'ok');
        push('Tasks: assembleDebug, assembleRelease, build, test, lint, clean', 'muted');
        return out;
      }
      const task = args.find((a) => !a.startsWith('-')) ?? 'assembleDebug';
      await host.runGradle(task);
      return out;
    }

    case 'mvn':
    case 'mvnw': {
      if (args.includes('-v') || args.includes('--version')) {
        push('APKForge Maven Runner (pom.xml -> test / package / clean)', 'ok');
        return out;
      }
      // Skip `-f <pom>` when extracting Maven goal
      const filtered: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-f' || args[i] === '--file') {
          i += 1;
          continue;
        }
        if (!args[i].startsWith('-')) filtered.push(args[i]);
      }
      const goal = filtered[0] ?? 'package';
      await host.runMaven(goal);
      return out;
    }

    case 'keytool': {
      const keys = host.keySummary();
      if (args.includes('-list')) {
        push('Keystore type: PKCS8 + X.509v3 (WebCrypto RSA-2048)', 'ok');
        push('  debug   : ' + keys.debug, 'muted');
        push('  release : ' + keys.release, 'muted');
        return out;
      }
      push('Use the Signing Keys panel in the sidebar to create or import RSA-2048 keys.', 'info');
      return out;
    }

    case 'sdkmanager':
      push('Target Android SDK profile: API 34 (minSdk 24, targetSdk 34)', 'ok');
      return out;

    case 'avdmanager':
    case 'emulator':
      push('In-browser WebView Device Dock active — use `adb install` or the Build panel to mount APKs.', 'ok');
      return out;

    case 'adb': {
      const sub = args[0];
      if (sub === 'devices') {
        push('List of devices attached', 'ok');
        push('emulator-5554\tdevice product:apkforge_webview model:Pixel_8 transport_id:1', 'muted');
        return out;
      }
      if (sub === 'install') {
        const apkArg = args.filter((a) => !a.startsWith('-')).slice(1)[0];
        const { artifact, error } = pickApkArtifact(host.artifacts(), apkArg);
        if (!artifact) {
          push(`adb: failed to install: ${error}`, 'err');
          return out;
        }
        host.installLastApk();
        push(`Performing Streamed Install (${artifact.name})`, 'ok');
        push('Success', 'ok');
        return out;
      }
      push('Android Debug Bridge (studio device bridge) — commands: `adb devices`, `adb install <apk>`', 'info');
      return out;
    }

    case 'apksigner': {
      // Real cryptographic & binary APK verification!
      const nonFlags = args.filter((a) => !a.startsWith('-')).filter((a) => a !== 'verify');
      const explicitApk = nonFlags[0];
      const { artifact, error } = pickApkArtifact(host.artifacts(), explicitApk);
      if (!artifact) {
        push(`apksigner: ${error}`, 'err');
        return out;
      }
      const inspected = await inspectApkBlob(artifact.blob, artifact.name);
      const v = inspected.verification;
      if (!v.validZip) {
        push(`DOES NOT VERIFY: ${artifact.name} is not a valid ZIP archive`, 'err');
        return out;
      }
      if (!v.hasV1Signature && !v.hasV2Signature) {
        push(`DOES NOT VERIFY: ${artifact.name} contains no v1 or v2 signatures`, 'err');
        return out;
      }
      if (v.hasV2Signature && !v.v2SignatureVerified) {
        push(`DOES NOT VERIFY: APK Signature Scheme v2 digest/RSA verification failed`, 'err');
        return out;
      }
      push(`Verifies (${artifact.name} · package=${inspected.packageName} · v${inspected.versionName})`, 'ok');
      push(`Verified using v1 scheme (JAR signing): ${v.hasV1Signature}`, v.hasV1Signature ? 'ok' : 'warn');
      push(
        `Verified using v2 scheme (APK Signature Scheme v2): ${v.v2SignatureVerified}`,
        v.v2SignatureVerified ? 'ok' : 'warn',
      );
      if (args.includes('--print-certs') && v.signerCertDer) {
        const certSha256 = await sha256Hex(v.signerCertDer);
        push(`Signer #1 certificate SHA-256 digest: ${certSha256}`, 'muted');
      }
      return out;
    }

    case 'zipalign': {
      // Real 4-byte ZIP STORED alignment verification!
      const nonFlags = args.filter((a) => !a.startsWith('-') && a !== '4');
      const explicitApk = nonFlags[0];
      const { artifact, error } = pickApkArtifact(host.artifacts(), explicitApk);
      if (!artifact) {
        push(`zipalign: ${error}`, 'err');
        return out;
      }
      const inspected = await inspectApkBlob(artifact.blob, artifact.name);
      if (!inspected.verification.validZip) {
        push(`zipalign: ${artifact.name}: invalid archive`, 'err');
        return out;
      }
      if (!inspected.verification.zipAligned4) {
        inspected.verification.unalignedEntries.forEach((e) => push(`  BAD alignment: ${e}`, 'err'));
        push('Verification FAILED', 'err');
        return out;
      }
      push(`Verifying alignment of ${artifact.name} (4)...`, 'muted');
      push('Verification successful', 'ok');
      return out;
    }

    case 'unzip': {
      const explicitApk = args.find((a) => !a.startsWith('-'));
      const { artifact, error } = pickApkArtifact(host.artifacts(), explicitApk);
      if (!artifact) {
        push(`unzip: ${error}`, 'err');
        return out;
      }
      const entries = await listApkEntries(artifact.blob).catch(() => []);
      push(`Archive: ${artifact.name} (${formatBytes(artifact.size)})`, 'ok');
      entries.forEach((e) => push(`  ${e}`));
      return out;
    }

    case 'sha256sum': {
      const targetArg = args.find((a) => !a.startsWith('-'));
      if (targetArg) {
        const vfsPath = resolve(cwd, targetArg);
        if (host.files[vfsPath] !== undefined) {
          const digest = await sha256Hex(new TextEncoder().encode(host.files[vfsPath]));
          push(`${digest}  ${targetArg}`);
          return out;
        }
      }
      const { artifact, error } = pickApkArtifact(host.artifacts(), targetArg);
      if (!artifact) {
        push(`sha256sum: ${error}`, 'err');
        return out;
      }
      const digest = artifact.sha256 ?? (await sha256Hex(new Uint8Array(await artifact.blob.arrayBuffer())));
      push(`${digest}  ${artifact.name}`);
      return out;
    }

    case 'opencode':
      push('Opening OpenCode assistant panel…', 'ok');
      host.openAssistant();
      return out;

    case 'apetizer':
    case 'appetizer':
      push('Opening https://appetizer.io/upload …', 'ok');
      window.open('https://appetizer.io/upload', '_blank', 'noopener');
      return out;

    case 'deliver':
    case 'package':
      host.openDeliver();
      push('Opening the delivery panel…', 'ok');
      return out;

    case 'open':
      if (args[0]) host.openFile(resolve(cwd, args[0]));
      return out;

    case 'docs':
      host.openDocs();
      return out;

    case 'exit':
      return out;

    default:
      push(`forge: command not found: ${cmd}`, 'err');
      push(`Type 'help' for the list of available commands.`, 'muted');
      return out;
  }
}
