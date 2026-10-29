import { buildApk, type ApkBuildResult } from './apk';
import type { LoadedKey } from './keys';
import { formatSize, parseProject, type Problem, type ProjectConfig } from './project';
import { reportToHtml, reportToJUnitXml, runTests, type TestReport } from './tests';
import type { FileMap } from './vfs';

export type LogTone = 'info' | 'ok' | 'warn' | 'err' | 'muted' | 'task';

export interface BuildLogLine {
  text: string;
  tone: LogTone;
}

export interface Artifact {
  id: string;
  name: string;
  kind: 'apk' | 'report' | 'zip';
  blob: Blob;
  size: number;
  sha256?: string;
  variant?: 'debug' | 'release';
}

export interface BuildHost {
  files: FileMap;
  config: ProjectConfig;
  problems?: Problem[];
  getKey: (variant: 'debug' | 'release') => LoadedKey | null;
  applyFiles: (patch: Record<string, string>) => void;
  deleteFiles?: (paths: string[]) => void;
}

export interface BuildOutcome {
  ok: boolean;
  artifacts: Artifact[];
  report?: TestReport;
  apk?: ApkBuildResult;
  summary: string;
  durationMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let artifactCounter = 0;
function nextId(prefix: string): string {
  artifactCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${artifactCounter}`;
}

function manifestReport(config: ProjectConfig, variant: string, hasDeprecatedPackageAttr: boolean): string {
  const lines = [
    `Manifest merger report for ${variant}`,
    '',
    `  namespace: ${config.namespace}`,
    `  applicationId: ${variant === 'debug' && !config.applicationId.endsWith('.debug') ? config.applicationId + '.debug' : config.applicationId}`,
    `  minSdk: ${config.minSdk}`,
    `  targetSdk: ${config.targetSdk}`,
    `  versionCode: ${config.versionCode}`,
    `  versionName: ${config.versionName}`,
    '',
  ];
  if (hasDeprecatedPackageAttr) {
    lines.push(
      'WARNING: package attribute found in source AndroidManifest.xml.',
      'Recommendation: declare namespace in app/build.gradle.kts instead.',
      '',
    );
  } else {
    lines.push('SUCCESS: Manifest merged cleanly with zero warnings.', '');
  }
  return lines.join('\n');
}

export async function runGradle(
  rawTask: string,
  host: BuildHost,
  emit: (line: BuildLogLine) => void,
): Promise<BuildOutcome> {
  const started = performance.now();
  const artifacts: Artifact[] = [];
  const log = (text: string, tone: LogTone = 'info') => emit({ text, tone });
  const task = rawTask.replace(/^:app:/, '');

  if (task === 'clean') {
    log('> Task :app:clean', 'task');
    await sleep(80);
    const toRemove = Object.keys(host.files).filter((p) => p.startsWith('app/build/') || p.startsWith('target/'));
    if (host.deleteFiles) {
      host.deleteFiles(toRemove);
    } else {
      for (const p of toRemove) delete host.files[p];
    }
    log(`Removed ${toRemove.length} build file${toRemove.length === 1 ? '' : 's'}`, 'muted');
    log('BUILD SUCCESSFUL in 0.1s', 'ok');
    return { ok: true, artifacts, summary: 'clean', durationMs: Math.round(performance.now() - started) };
  }

  if (task === 'tasks' || task === 'help') {
    const rows = [
      'Build tasks',
      '-----------',
      'assembleDebug   - Assembles the debug APK (v1 + v2 signed)',
      'assembleRelease - Assembles the signed release APK (v1 + v2 signed)',
      'build           - Assembles both variants, runs unit tests and Android lint',
      'clean           - Deletes app/build and target directories',
      'lint            - Runs Android lint checks on the project',
      'test            - Runs the unit test suite',
      'installDebug    - Assembles and installs the debug APK in the emulator',
    ];
    rows.forEach((r) => log(r, 'muted'));
    return { ok: true, artifacts, summary: 'tasks', durationMs: Math.round(performance.now() - started) };
  }

  const problems = host.problems ?? parseProject(host.files).problems;
  const fatalErrors = problems.filter((p) => p.severity === 'error');

  log(`> Gradle ${task}`, 'muted');
  log('> Toolchain: APKForge AXML/ARSC/DEX 035 + APK Sig v1/v2', 'muted');
  log('', 'info');

  if (fatalErrors.length > 0 && task !== 'lint') {
    fatalErrors.forEach((e) => log(`ERROR: ${e.message}`, 'err'));
    log('BUILD FAILED', 'err');
    return {
      ok: false,
      artifacts,
      summary: 'build failed',
      durationMs: Math.round(performance.now() - started),
    };
  }

  const isTestOnly = task === 'test' || task === 'testDebugUnitTest';
  const isLintOnly = task === 'lint' || task === 'lintDebug';
  const isFullBuild = task === 'build';

  // ---- 1. APK assembly (for assembleDebug, assembleRelease, installDebug, build) ----
  let lastApk: ApkBuildResult | undefined;
  if (!isTestOnly && !isLintOnly) {
    const variants: ('debug' | 'release')[] =
      task === 'assembleRelease' ? ['release'] : isFullBuild ? ['debug', 'release'] : ['debug'];

    const steps = [
      ':app:preBuild',
      ':app:processDebugMainManifest',
      ':app:compileDebugResources',
      ':app:compileDebugKotlin',
      ':app:mergeDexDebug',
      ':app:packageDebug',
      ':app:signDebugApk',
    ];

    for (const variant of variants) {
      const suffix = variant === 'debug' ? 'Debug' : 'Release';
      for (const step of steps) {
        log(`> Task ${step.replace('Debug', suffix)}`, 'task');
        await sleep(35);
      }

      const key = host.getKey(variant);
      if (variant === 'release' && !key) {
        log('! No release signing key active — APK will be packaged unsigned.', 'warn');
      }

      try {
        const apk = await buildApk({
          files: host.files,
          config: host.config,
          variant,
          key,
        });
        lastApk = apk;

        const artifact: Artifact = {
          id: nextId('apk'),
          name: apk.fileName,
          kind: 'apk',
          blob: apk.blob,
          size: apk.size,
          sha256: apk.sha256,
          variant,
        };
        artifacts.push(artifact);

        log(`> Task :app:assemble${suffix}`, 'task');
        log(
          `APK ${variant}: ${apk.fileName} · ${formatSize(apk.size)} · sha256 ${apk.sha256.slice(0, 16)}…`,
          'ok',
        );
        log(
          apk.signed
            ? `Signed with "${key!.alias}" (JAR v1 + APK Signature Scheme v2, 4-byte zipaligned)`
            : 'Unsigned APK container (4-byte zipaligned)',
          apk.signed ? 'ok' : 'warn',
        );

        const manifestSrc = host.files['app/src/main/AndroidManifest.xml'] ?? '';
        host.applyFiles({
          [`app/build/outputs/apk/${variant}/output-metadata.json`]: JSON.stringify(
            {
              version: 3,
              artifactType: { type: 'APK', kind: 'Directory' },
              applicationId:
                variant === 'debug' && !host.config.applicationId.endsWith('.debug')
                  ? `${host.config.applicationId}.debug`
                  : host.config.applicationId,
              variantName: variant,
              elements: [
                {
                  type: 'SINGLE',
                  outputFile: apk.fileName,
                  size: apk.size,
                  sha256: apk.sha256,
                  signed: apk.signed,
                  signatureSchemes: apk.signed ? ['v1', 'v2'] : [],
                },
              ],
            },
            null,
            2,
          ),
          [`app/build/intermediates/merged_manifests/${variant}/AndroidManifest.xml`]: manifestSrc,
          [`app/build/outputs/logs/manifest-merger-${variant}-report.txt`]: manifestReport(
            host.config,
            variant,
            /\spackage\s*=/.test(manifestSrc),
          ),
        });
      } catch (error) {
        log(`FAILURE: ${(error as Error).message}`, 'err');
        return {
          ok: false,
          artifacts,
          summary: 'build failed',
          durationMs: Math.round(performance.now() - started),
        };
      }
    }
  }

  // ---- 2. Unit tests (for test, testDebugUnitTest, build) ------------------
  let report: TestReport | undefined;
  if (isTestOnly || isFullBuild) {
    log('> Task :app:compileDebugUnitTestSources', 'task');
    await sleep(60);
    log('> Task :app:testDebugUnitTest', 'task');
    report = await runTests(host.files);
    const xml = reportToJUnitXml(report);
    const html = reportToHtml(report);
    host.applyFiles({
      'app/build/test-results/testDebugUnitTest/TEST-ForgeDeck.xml': xml,
      'app/build/reports/tests/testDebugUnitTest/index.html': html,
    });
    report.results.forEach((r) => {
      log(
        `  ${r.passed ? 'PASSED' : 'FAILED'} ${r.suite} > ${r.name} (${r.durationMs} ms)${r.error ? ' — ' + r.error : ''}`,
        r.passed ? 'ok' : 'err',
      );
    });
    log(
      `${report.passed}/${report.total} unit tests passed (${report.failed} failed) — report saved to app/build/reports/tests`,
      report.failed ? 'err' : 'ok',
    );
    if (report.failed > 0) {
      log(`BUILD FAILED in ${((performance.now() - started) / 1000).toFixed(1)}s`, 'err');
      return {
        ok: false,
        artifacts,
        report,
        apk: lastApk,
        summary: `${report.passed}/${report.total} tests passed (${report.failed} failed)`,
        durationMs: Math.round(performance.now() - started),
      };
    }
  }

  // ---- 3. Android Lint (for lint, lintDebug, build) ------------------------
  if (isLintOnly || isFullBuild) {
    log('> Task :app:lintDebug', 'task');
    await sleep(60);
    const lines = problems.map(
      (p) => `${p.file ?? 'project'}: ${p.severity.toUpperCase()}: ${p.message} [${p.source}]`,
    );
    const errCount = problems.filter((p) => p.severity === 'error').length;
    const warnCount = problems.filter((p) => p.severity === 'warning').length;
    const reportText = [
      'Android Lint results',
      `Generated at ${new Date().toISOString()}`,
      '',
      ...(lines.length ? lines : ['No issues found.']),
      '',
      `${errCount} errors, ${warnCount} warnings`,
    ].join('\n');
    host.applyFiles({ 'app/build/reports/lint-results-debug.txt': reportText });
    if (problems.length === 0) {
      log('Lint found 0 errors, 0 warnings.', 'ok');
    } else {
      problems.forEach((p) =>
        log(`${p.severity.toUpperCase()}: ${p.message}`, p.severity === 'error' ? 'err' : 'warn'),
      );
    }
    log('Lint report written to app/build/reports/lint-results-debug.txt', 'ok');
    if (isLintOnly) {
      log(errCount === 0 ? 'BUILD SUCCESSFUL' : 'BUILD FAILED', errCount === 0 ? 'ok' : 'err');
      return {
        ok: errCount === 0,
        artifacts,
        summary: `lint: ${errCount} errors, ${warnCount} warnings`,
        durationMs: Math.round(performance.now() - started),
      };
    }
  }

  log(`BUILD SUCCESSFUL in ${((performance.now() - started) / 1000).toFixed(1)}s`, 'ok');

  if (isTestOnly && report) {
    return {
      ok: report.failed === 0,
      artifacts,
      report,
      summary: `${report.passed}/${report.total} tests passed`,
      durationMs: Math.round(performance.now() - started),
    };
  }

  if (isFullBuild) {
    return {
      ok: true,
      artifacts,
      report,
      apk: lastApk,
      summary: `debug + release APKs (${artifacts.length}) · ${report ? `${report.passed}/${report.total} tests` : 'ok'}`,
      durationMs: Math.round(performance.now() - started),
    };
  }

  return {
    ok: true,
    artifacts,
    apk: lastApk,
    summary: lastApk ? `${lastApk.variant} APK · ${formatSize(lastApk.size)}` : 'build complete',
    durationMs: Math.round(performance.now() - started),
  };
}

export async function runMaven(
  goal: string,
  host: BuildHost,
  emit: (line: BuildLogLine) => void,
): Promise<BuildOutcome> {
  const started = performance.now();
  const artifacts: Artifact[] = [];
  const log = (text: string, tone: LogTone = 'info') => emit({ text, tone });

  log('[INFO] Scanning for projects...', 'muted');
  await sleep(60);

  if (goal === 'clean') {
    const toRemove = Object.keys(host.files).filter((p) => p.startsWith('target/'));
    if (host.deleteFiles) {
      host.deleteFiles(toRemove);
    } else {
      for (const p of toRemove) delete host.files[p];
    }
    log(`[INFO] Deleting target (${toRemove.length} files)`, 'muted');
    log('[INFO] BUILD SUCCESS', 'ok');
    return {
      ok: true,
      artifacts,
      summary: 'maven clean',
      durationMs: Math.round(performance.now() - started),
    };
  }

  log('[INFO] --- maven-surefire-plugin:3.2.5:test (default-test) @ forge-droid ---', 'task');
  const report = await runTests(host.files);
  host.applyFiles({
    'target/surefire-reports/TEST-forge-droid.xml': reportToJUnitXml(report),
    'target/surefire-reports/index.html': reportToHtml(report),
  });
  report.results.forEach((r) =>
    log(`[INFO] ${r.passed ? 'PASSED' : 'FAILED'} ${r.suite}.${r.name}`, r.passed ? 'ok' : 'err'),
  );
  log(`[INFO] Tests run: ${report.total}, Failures: ${report.failed}`, report.failed ? 'err' : 'ok');

  if (goal === 'test' || report.failed > 0) {
    log(report.failed === 0 ? '[INFO] BUILD SUCCESS' : '[ERROR] BUILD FAILURE', report.failed === 0 ? 'ok' : 'err');
    return {
      ok: report.failed === 0,
      artifacts,
      report,
      summary: `${report.passed}/${report.total} tests passed`,
      durationMs: Math.round(performance.now() - started),
    };
  }

  log('[INFO] --- android-maven-plugin:4.6.0:apk (default-apk) @ forge-droid ---', 'task');
  const key = host.getKey('release') ?? host.getKey('debug');
  const apk = await buildApk({ files: host.files, config: host.config, variant: 'release', key });
  artifacts.push({
    id: nextId('apk'),
    name: apk.fileName,
    kind: 'apk',
    blob: apk.blob,
    size: apk.size,
    sha256: apk.sha256,
    variant: 'release',
  });
  host.applyFiles({
    'target/maven-status/forge-droid/pom-default.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<project>\n  <artifactId>forge-droid</artifactId>\n  <version>${host.config.versionName}</version>\n</project>\n`,
  });
  log(
    `[INFO] Built ${apk.fileName} · ${formatSize(apk.size)} (${apk.signed ? 'v1 + v2 signed' : 'unsigned'})`,
    'ok',
  );
  log('[INFO] BUILD SUCCESS', 'ok');

  return {
    ok: true,
    artifacts,
    report,
    apk,
    summary: `maven package · ${formatSize(apk.size)}`,
    durationMs: Math.round(performance.now() - started),
  };
}
