/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { inspectApkBlob, type InspectedApk } from './apk';
import { runGradle, runMaven, type Artifact, type BuildLogLine } from './build';
import { createSigningKey, importSigningKey, sha256Hex, type LoadedKey, type SigningKey } from './keys';
import { parseProject, type Problem, type ProjectConfig } from './project';
import { runCommand, type Out } from './shell';
import { createTemplate, TEMPLATES } from './templates';
import { runTests, type TestReport } from './tests';
import type { FileMap } from './vfs';

export type ActivityView = 'explorer' | 'search' | 'keys' | 'build' | 'assistant';
export type BottomTab = 'terminal' | 'problems' | 'output' | 'tests';
export type RightTab = 'device' | 'assistant';

export interface TerminalLine {
  id: number;
  text: string;
  tone?: Out['tone'];
}

export interface InstalledApp {
  id: string;
  name: string;
  packageName: string;
  version: string;
  blob: Blob;
  installedAt: string;
  hasWebPayload: boolean;
  signedV1: boolean;
  signedV2: boolean;
  zipAligned: boolean;
  entriesCount: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const FILES_KEY = 'apkforge.files.v3';
const KEYS_KEY = 'apkforge.keys.v3';
const TEMPLATE_KEY = 'apkforge.template.v3';

function loadFiles(): FileMap {
  try {
    const raw = localStorage.getItem(FILES_KEY);
    if (raw) return JSON.parse(raw) as FileMap;
  } catch {
    /* ignore */
  }
  return createTemplate('webview');
}

function loadKeys(): { debug: SigningKey | null; release: SigningKey | null } {
  try {
    const raw = localStorage.getItem(KEYS_KEY);
    if (raw) return JSON.parse(raw) as { debug: SigningKey | null; release: SigningKey | null };
  } catch {
    /* ignore */
  }
  return { debug: null, release: null };
}

function pickInitialWelcomeFile(files: FileMap): string | undefined {
  return ['app/src/main/java/com/forge/droid/MainActivity.kt', 'app/build.gradle.kts'].find(
    (path) => Boolean(files[path]),
  );
}

export interface StudioValue {
  files: FileMap;
  setFile: (path: string, content: string) => void;
  writeFiles: (patch: Record<string, string>) => void;
  deleteFiles: (paths: string[]) => void;
  loadTemplate: (templateId: string) => void;
  templateId: string;

  tabs: string[];
  activeFile?: string;
  openFile: (path: string) => void;
  closeTab: (path: string) => void;

  cwd: string;
  setCwd: (path: string) => void;

  config: ProjectConfig;
  problems: Problem[];

  terminal: TerminalLine[];
  shellHistory: string[];
  pushTerminal: (text: string, tone?: Out['tone']) => void;
  clearTerminal: () => void;
  runShell: (line: string) => Promise<void>;

  output: BuildLogLine[];
  clearOutput: () => void;
  building: boolean;
  buildArtifacts: Artifact[];
  lastTestReport: TestReport | null;
  runUnitTests: () => Promise<TestReport>;
  buildGradle: (task: string) => Promise<void>;
  buildMaven: (goal: string) => Promise<void>;

  keys: { debug: SigningKey | null; release: SigningKey | null };
  generateKey: (variant: 'debug' | 'release', subject?: string) => Promise<void>;
  loadedKey: (variant: 'debug' | 'release') => LoadedKey | null;

  apps: InstalledApp[];
  installApk: (artifact: Artifact) => Promise<void>;
  installExternalApkFile: (file: File) => Promise<InspectedApk>;
  uninstallApp: (id: string) => void;

  activity: ActivityView;
  setActivity: (view: ActivityView) => void;
  mobilePanel: boolean;
  setMobilePanel: Dispatch<SetStateAction<boolean>>;
  bottomTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;
  rightTab: RightTab;
  setRightTab: (tab: RightTab) => void;
  rightDockOpen: boolean;
  setRightDockOpen: Dispatch<SetStateAction<boolean>>;

  paletteOpen: boolean;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  deliverOpen: boolean;
  setDeliverOpen: Dispatch<SetStateAction<boolean>>;
  docsOpen: boolean;
  setDocsOpen: Dispatch<SetStateAction<boolean>>;

  chat: ChatMessage[];
  chatBusy: boolean;
  sendChat: (text: string) => Promise<void>;
  clearChat: () => void;
  aiEndpoint: string;
  setAiEndpoint: (value: string) => void;
  aiModel: string;
  setAiModel: (value: string) => void;
  aiKey: string;
  setAiKey: (value: string) => void;

  buildLogText: () => string;
}

const StudioContext = createContext<StudioValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<FileMap>(() => loadFiles());
  const [templateId, setTemplateId] = useState<string>(() => localStorage.getItem(TEMPLATE_KEY) ?? 'webview');
  const [tabs, setTabs] = useState<string[]>(() => {
    const initial = pickInitialWelcomeFile(loadFiles());
    return initial ? [initial] : [];
  });
  const [activeFile, setActiveFile] = useState<string | undefined>(() => pickInitialWelcomeFile(loadFiles()));
  const [cwd, setCwd] = useState('');
  const [shellHistory, setShellHistory] = useState<string[]>([]);
  const [terminal, setTerminal] = useState<TerminalLine[]>([
    { id: 0, text: 'APKForge Studio — Android Binary APK Compiler & Signer (v1 + v2)', tone: 'ok' },
    { id: 1, text: "Type 'help' for commands, or run 'gradle assembleDebug'.", tone: 'muted' },
  ]);
  const [output, setOutput] = useState<BuildLogLine[]>([]);
  const [building, setBuilding] = useState(false);
  const [buildArtifacts, setBuildArtifacts] = useState<Artifact[]>([]);
  const [lastTestReport, setLastTestReport] = useState<TestReport | null>(null);
  const [keys, setKeys] = useState(() => loadKeys());
  const [loadedKeys, setLoadedKeys] = useState<{ debug: LoadedKey | null; release: LoadedKey | null }>({
    debug: null,
    release: null,
  });
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [activity, setActivity] = useState<ActivityView>('explorer');
  const [mobilePanel, setMobilePanel] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal');
  const [rightTab, setRightTab] = useState<RightTab>('device');
  const [rightDockOpen, setRightDockOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'OpenCode is ready. Connect a running `opencode serve` (`http://127.0.0.1:4096/v1`) or OpenAI-compatible endpoint in settings for live streaming, or ask directly using the built-in studio assistant.',
    },
  ]);
  const [chatBusy, setChatBusy] = useState(false);
  const [aiEndpoint, setAiEndpoint] = useState('http://127.0.0.1:4096/v1');
  const [aiModel, setAiModel] = useState('opencode/big');
  const [aiKey, setAiKey] = useState('');

  const lineId = useRef(2);
  const logBuffer = useRef<string[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(FILES_KEY, JSON.stringify(files));
    } catch {
      /* quota */
    }
  }, [files]);

  useEffect(() => {
    try {
      localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
    } catch {
      /* ignore */
    }
  }, [keys]);

  useEffect(() => {
    localStorage.setItem(TEMPLATE_KEY, templateId);
  }, [templateId]);

  const pushTerminal = useCallback((text: string, tone: Out['tone'] = 'info') => {
    lineId.current += 1;
    setTerminal((prev) => [...prev, { id: lineId.current, text, tone }]);
  }, []);

  const clearTerminal = useCallback(() => setTerminal([]), []);

  const writeFiles = useCallback((patch: Record<string, string>) => {
    setFiles((prev) => ({ ...prev, ...patch }));
  }, []);

  const setFile = useCallback((path: string, content: string) => {
    setFiles((prev) => ({ ...prev, [path]: content }));
  }, []);

  const deleteFiles = useCallback((paths: string[]) => {
    if (!paths.length) return;
    setFiles((prev) => {
      const next = { ...prev };
      for (const path of paths) delete next[path];
      return next;
    });
    setTabs((prev) => prev.filter((t) => !paths.includes(t)));
  }, []);

  const loadTemplate = useCallback((id: string) => {
    const nextFiles = createTemplate(id);
    const welcome = pickInitialWelcomeFile(nextFiles);
    setFiles(nextFiles);
    setTemplateId(id);
    setTabs(welcome ? [welcome] : []);
    setActiveFile(welcome);
    setLastTestReport(null);
  }, []);

  const openFile = useCallback((path: string) => {
    setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveFile(path);
    setActivity('explorer');
  }, []);

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t !== path);
      setActiveFile((current) => (current === path ? next[next.length - 1] : current));
      return next;
    });
  }, []);

  const { config, problems } = useMemo(() => parseProject(files), [files]);

  const loadedKey = useCallback(
    (variant: 'debug' | 'release'): LoadedKey | null => loadedKeys[variant],
    [loadedKeys],
  );

  const ensureKey = useCallback(
    async (variant: 'debug' | 'release'): Promise<LoadedKey | null> => {
      const existing = loadedKeys[variant];
      if (existing) return existing;
      const existingRecord = keys[variant];
      if (!existingRecord) {
        const created = await createSigningKey({
          label: variant === 'debug' ? 'Android debug key' : 'Release key',
          alias: variant === 'debug' ? 'androiddebugkey' : 'forge-release',
          storePassword: variant === 'debug' ? 'android' : 'forge-release',
          keyPassword: variant === 'debug' ? 'android' : 'forge-release',
          subject:
            variant === 'debug'
              ? 'CN=Android Debug,O=Android,C=US'
              : 'CN=Forge Release,O=Forge Studio,C=DE',
          validDays: 10000,
        });
        const signingRecord: SigningKey = {
          id: created.id,
          label: created.label,
          alias: created.alias,
          storePassword: created.storePassword,
          keyPassword: created.keyPassword,
          subject: created.subject,
          issuer: created.issuer,
          validDays: created.validDays,
          createdAt: created.createdAt,
          bits: created.bits,
          fingerprintSha256: created.fingerprintSha256,
          certificatePem: created.certificatePem,
          privateKeyPem: created.privateKeyPem,
          serialHex: created.serialHex,
        };
        setKeys((prev) => ({ ...prev, [variant]: signingRecord }));
        setLoadedKeys((prev) => ({ ...prev, [variant]: created }));
        return created;
      }
      const imported = await importSigningKey(existingRecord);
      if (imported) setLoadedKeys((prev) => ({ ...prev, [variant]: imported }));
      return imported;
    },
    [keys, loadedKeys],
  );

  const generateKey = useCallback(
    async (variant: 'debug' | 'release', subject?: string) => {
      const created = await createSigningKey({
        label: variant === 'debug' ? 'Android debug key' : 'Release key',
        alias: variant === 'debug' ? 'androiddebugkey' : 'forge-release',
        storePassword: variant === 'debug' ? 'android' : 'forge-release',
        keyPassword: variant === 'debug' ? 'android' : 'forge-release',
        subject:
          subject ??
          (variant === 'debug'
            ? 'CN=Android Debug,O=Android,C=US'
            : 'CN=Forge Release,O=Forge Studio,C=DE'),
        validDays: 10000,
      });
      const signingRecord: SigningKey = {
        id: created.id,
        label: created.label,
        alias: created.alias,
        storePassword: created.storePassword,
        keyPassword: created.keyPassword,
        subject: created.subject,
        issuer: created.issuer,
        validDays: created.validDays,
        createdAt: created.createdAt,
        bits: created.bits,
        fingerprintSha256: created.fingerprintSha256,
        certificatePem: created.certificatePem,
        privateKeyPem: created.privateKeyPem,
        serialHex: created.serialHex,
      };
      setKeys((prev) => ({ ...prev, [variant]: signingRecord }));
      setLoadedKeys((prev) => ({ ...prev, [variant]: created }));
      writeFiles({
        [`keystore/${variant}.properties`]: [
          `key.alias=${signingRecord.alias}`,
          `key.store.password=${signingRecord.storePassword}`,
          `key.password=${signingRecord.keyPassword}`,
          `key.subject=${signingRecord.subject}`,
          `key.fingerprint=${signingRecord.fingerprintSha256}`,
          '',
        ].join('\n'),
        [`keystore/${variant}.pk8.pem`]: signingRecord.privateKeyPem,
        [`keystore/${variant}.cert.pem`]: signingRecord.certificatePem,
      });
    },
    [writeFiles],
  );

  const installApkInternal = useCallback(
    async (artifact: Artifact) => {
      const inspected = await inspectApkBlob(artifact.blob, artifact.name);
      const app: InstalledApp = {
        id: `${artifact.name}-${Date.now()}`,
        name: inspected.label || config.label || artifact.name,
        packageName: inspected.packageName || config.applicationId,
        version: inspected.versionName || config.versionName,
        blob: artifact.blob,
        installedAt: new Date().toISOString(),
        hasWebPayload: inspected.hasWebPayload,
        signedV1: inspected.verification.hasV1Signature,
        signedV2: inspected.verification.v2SignatureVerified,
        zipAligned: inspected.verification.zipAligned4,
        entriesCount: inspected.entries.length,
      };
      setApps((prev) => [app, ...prev.filter((a) => a.packageName !== app.packageName)]);
      setRightTab('device');
      setRightDockOpen(true);
    },
    [config],
  );

  const installExternalApkFile = useCallback(async (file: File): Promise<InspectedApk> => {
    const inspected = await inspectApkBlob(file, file.name);
    if (!inspected.verification.validZip) {
      throw new Error(`${file.name} is not a valid APK/ZIP archive`);
    }
    const sha256 = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    const artifact: Artifact = {
      id: `ext-${Date.now().toString(36)}`,
      name: file.name,
      kind: 'apk',
      blob: file,
      size: file.size,
      sha256,
      variant: file.name.includes('debug') ? 'debug' : 'release',
    };
    setBuildArtifacts((prev) => [...prev.filter((a) => a.name !== file.name), artifact]);
    const app: InstalledApp = {
      id: `${file.name}-${Date.now()}`,
      name: inspected.label || file.name.replace(/\.apk$/i, ''),
      packageName: inspected.packageName,
      version: inspected.versionName,
      blob: file,
      installedAt: new Date().toISOString(),
      hasWebPayload: inspected.hasWebPayload,
      signedV1: inspected.verification.hasV1Signature,
      signedV2: inspected.verification.v2SignatureVerified,
      zipAligned: inspected.verification.zipAligned4,
      entriesCount: inspected.entries.length,
    };
    setApps((prev) => [app, ...prev.filter((a) => a.packageName !== app.packageName)]);
    setRightTab('device');
    setRightDockOpen(true);
    return inspected;
  }, []);

  const runUnitTests = useCallback(async (): Promise<TestReport> => {
    const report = await runTests(files);
    setLastTestReport(report);
    return report;
  }, [files]);

  const buildGradle = useCallback(
    async (task: string) => {
      setBuilding(true);
      const normalized = task.replace(/^:app:/, '');
      setBottomTab(normalized === 'test' || normalized === 'testDebugUnitTest' ? 'tests' : 'output');
      setOutput([]);
      logBuffer.current = [];
      const emit = (line: BuildLogLine) => {
        setOutput((prev) => [...prev, line]);
        logBuffer.current.push(line.text);
      };
      try {
        const needsDebug = normalized.includes('Debug') || normalized === 'build';
        const needsRelease = normalized.includes('Release') || normalized === 'build';
        const debugKey = needsDebug ? await ensureKey('debug') : null;
        const releaseKey = needsRelease ? await ensureKey('release') : null;
        const outcome = await runGradle(
          task,
          {
            files,
            config,
            problems,
            getKey: (variant) => (variant === 'debug' ? debugKey : releaseKey),
            applyFiles: writeFiles,
            deleteFiles,
          },
          emit,
        );
        if (outcome.report) {
          setLastTestReport(outcome.report);
        }
        if (outcome.artifacts.length) {
          setBuildArtifacts((prev) => {
            const incomingNames = new Set(outcome.artifacts.map((a) => a.name));
            return [...prev.filter((a) => !incomingNames.has(a.name)), ...outcome.artifacts];
          });
          const latest = outcome.artifacts[outcome.artifacts.length - 1];
          if (latest) await installApkInternal(latest);
        } else if (normalized === 'clean') {
          setBuildArtifacts([]);
        }
      } catch (error) {
        emit({ text: `FAILURE: ${(error as Error).message}`, tone: 'err' });
      } finally {
        setBuilding(false);
      }
    },
    [config, deleteFiles, ensureKey, files, installApkInternal, problems, writeFiles],
  );

  const buildMaven = useCallback(
    async (goal: string) => {
      setBuilding(true);
      setBottomTab(goal === 'test' ? 'tests' : 'output');
      setOutput([]);
      logBuffer.current = [];
      const emit = (line: BuildLogLine) => {
        setOutput((prev) => [...prev, line]);
        logBuffer.current.push(line.text);
      };
      try {
        const key = goal === 'clean' || goal === 'test' ? null : await ensureKey('release');
        const outcome = await runMaven(
          goal,
          {
            files,
            config,
            problems,
            getKey: () => key,
            applyFiles: writeFiles,
            deleteFiles,
          },
          emit,
        );
        if (outcome.report) {
          setLastTestReport(outcome.report);
        }
        if (outcome.artifacts.length) {
          setBuildArtifacts((prev) => {
            const incomingNames = new Set(outcome.artifacts.map((a) => a.name));
            return [...prev.filter((a) => !incomingNames.has(a.name)), ...outcome.artifacts];
          });
          await installApkInternal(outcome.artifacts[outcome.artifacts.length - 1]);
        }
      } catch (error) {
        emit({ text: `FAILURE: ${(error as Error).message}`, tone: 'err' });
      } finally {
        setBuilding(false);
      }
    },
    [config, deleteFiles, ensureKey, files, installApkInternal, problems, writeFiles],
  );

  const runShell = useCallback(
    async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const nextHistory = [...shellHistory, trimmed];
      setShellHistory(nextHistory);
      pushTerminal(`forge:${cwd ? '/' + cwd : '~'}$ ${trimmed}`, 'cmd');
      const host = {
        files,
        cwd,
        env: {
          ANDROID_HOME: '/opt/android-sdk',
          ANDROID_SDK_ROOT: '/opt/android-sdk',
          JAVA_HOME: '/opt/jdk-17',
          GRADLE_USER_HOME: '/home/forge/.gradle',
          PATH: '/usr/local/bin:/opt/jdk-17/bin:/opt/android-sdk/platform-tools',
          PWD: '/' + cwd,
          TERM: 'xterm-256color',
          LANG: 'C.UTF-8',
        },
        write: writeFiles,
        remove: deleteFiles,
        exists: (path: string) => Boolean(files[path]),
        runGradle: buildGradle,
        runMaven: buildMaven,
        openFile,
        setCwd,
        openAssistant: () => {
          setActivity('assistant');
          setRightTab('assistant');
          setRightDockOpen(true);
        },
        openDocs: () => setDocsOpen(true),
        openDeliver: () => setDeliverOpen(true),
        installLastApk: () => {
          const last = buildArtifacts[buildArtifacts.length - 1];
          if (last) void installApkInternal(last);
        },
        artifacts: () =>
          buildArtifacts.map((a) => ({ name: a.name, size: a.size, sha256: a.sha256, blob: a.blob })),
        keySummary: () => ({
          debug: keys.debug ? `${keys.debug.alias} · ${keys.debug.fingerprintSha256}` : 'not generated',
          release: keys.release ? `${keys.release.alias} · ${keys.release.fingerprintSha256}` : 'not generated',
        }),
        clearScreen: clearTerminal,
        history: () => nextHistory,
      };
      const result = await runCommand(host, trimmed);
      result.forEach((entry) => pushTerminal(entry.text, entry.tone));
    },
    [
      buildArtifacts,
      buildGradle,
      buildMaven,
      clearTerminal,
      cwd,
      deleteFiles,
      files,
      installApkInternal,
      keys,
      openFile,
      pushTerminal,
      shellHistory,
      writeFiles,
    ],
  );

  const installApk = useCallback(
    async (artifact: Artifact) => {
      await installApkInternal(artifact);
    },
    [installApkInternal],
  );

  const uninstallApp = useCallback((id: string) => {
    setApps((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const sendChat = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || chatBusy) return;
      const historySnapshot = chat;
      // Add user prompt + empty assistant streaming slot so all streamed tokens append into ONE bubble!
      setChat((prev) => [...prev, { role: 'user', content: prompt }, { role: 'assistant', content: '' }]);
      setChatBusy(true);
      const { localAssistantReply, streamChat } = await import('./ai');
      try {
        const messages = [
          {
            role: 'system' as const,
            content:
              'You are OpenCode, an AI coding assistant embedded in APKForge Studio (an Android IDE & APK v1+v2 compiler in the browser). Answer concisely with markdown.',
          },
          ...historySnapshot.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user' as const, content: prompt },
        ];
        const answer = await streamChat(
          { provider: 'custom', baseUrl: aiEndpoint, apiKey: aiKey, model: aiModel },
          messages,
          (delta) => {
            setChat((prev) => {
              const next = [...prev];
              const lastIdx = next.length - 1;
              if (lastIdx >= 0 && next[lastIdx].role === 'assistant') {
                next[lastIdx] = { role: 'assistant', content: next[lastIdx].content + delta };
              } else {
                next.push({ role: 'assistant', content: delta });
              }
              return next;
            });
          },
        );
        if (!answer) throw new Error('empty response');
      } catch {
        const fallback = localAssistantReply(prompt, { files, config, problems, activeFile });
        setChat((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].role === 'assistant' && !next[lastIdx].content) {
            next[lastIdx] = { role: 'assistant', content: fallback };
          } else {
            next.push({ role: 'assistant', content: fallback });
          }
          return next;
        });
      } finally {
        setChatBusy(false);
      }
    },
    [activeFile, aiEndpoint, aiKey, aiModel, chat, chatBusy, config, files, problems],
  );

  const clearChat = useCallback(() => {
    setChat([]);
  }, []);

  const buildLogText = useCallback(() => logBuffer.current.join('\n'), []);

  const value: StudioValue = {
    files,
    setFile,
    writeFiles,
    deleteFiles,
    loadTemplate,
    templateId,
    tabs,
    activeFile,
    openFile,
    closeTab,
    cwd,
    setCwd,
    config,
    problems,
    terminal,
    shellHistory,
    pushTerminal,
    clearTerminal,
    runShell,
    output,
    clearOutput: () => setOutput([]),
    building,
    buildArtifacts,
    lastTestReport,
    runUnitTests,
    buildGradle,
    buildMaven,
    keys,
    generateKey,
    loadedKey,
    apps,
    installApk,
    installExternalApkFile,
    uninstallApp,
    activity,
    setActivity,
    mobilePanel,
    setMobilePanel,
    bottomTab,
    setBottomTab,
    rightTab,
    setRightTab,
    rightDockOpen,
    setRightDockOpen,
    paletteOpen,
    setPaletteOpen,
    deliverOpen,
    setDeliverOpen,
    docsOpen,
    setDocsOpen,
    chat,
    chatBusy,
    sendChat,
    clearChat,
    aiEndpoint,
    setAiEndpoint,
    aiModel,
    setAiModel,
    aiKey,
    setAiKey,
    buildLogText,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used inside StudioProvider');
  return ctx;
}

export const TEMPLATE_LIST = TEMPLATES;
