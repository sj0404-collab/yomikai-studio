import type { Problem, ProjectConfig } from './project';
import type { FileMap } from './vfs';

export interface AiConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const AI_PRESETS: { id: string; label: string; baseUrl: string; model: string; needsKey: boolean }[] = [
  { id: 'opencode', label: 'OpenCode (local `opencode serve`)', baseUrl: 'http://127.0.0.1:4096/v1', model: 'opencode/big', needsKey: false },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder', needsKey: false },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', needsKey: true },
];

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'opencode',
  baseUrl: 'http://127.0.0.1:4096/v1',
  apiKey: '',
  model: 'opencode/big',
};

export interface AssistantContext {
  files: FileMap;
  config: ProjectConfig;
  problems: Problem[];
  activeFile?: string;
}

/**
 * Streams a completion from any OpenAI-compatible endpoint (`opencode serve`,
 * Ollama, OpenRouter, OpenAI, vLLM). Handles both `\n` and `\r\n` SSE frames.
 */
export async function streamChat(
  config: AiConfig,
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: 0.2,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string }; delta?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.delta?.content ?? '';
    if (content) onDelta(content);
    return content;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('streaming is not supported by this endpoint');

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const json = JSON.parse(payload) as {
        choices?: { delta?: { content?: string }; message?: { content?: string } }[];
      };
      const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content;
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    } catch {
      /* ignore partial or keep-alive frame */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        buffer.split(/\r?\n/).forEach(processLine);
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) processLine(line);
  }

  return full;
}

/** Context aware fallback used when no endpoint is reachable. */
export function localAssistantReply(prompt: string, ctx: AssistantContext): string {
  const p = prompt.toLowerCase();
  const fileCount = Object.keys(ctx.files).length;
  const has = (needle: string) => p.includes(needle);

  if (has('keystore') || has('sign') || has('key') || has('release key') || has('debug key')) {
    return [
      '**Signing in APKForge Studio**',
      '',
      'Two RSA-2048 X.509v3 key slots are managed in the **Keys** panel:',
      '',
      '- `debug` — alias `androiddebugkey`, password `android`. Generated automatically for `assembleDebug`.',
      '- `release` — alias `forge-release`, generated with WebCrypto (`digitalSignature` KeyUsage) and exported as PKCS#8 + X.509 PEM.',
      '',
      'Every signed APK receives **both**:',
      '- **JAR v1** (`META-INF/MANIFEST.MF`, `CERT.SF` with `X-Android-APK-Signed: 2`, and PKCS#7 `CERT.RSA`)',
      '- **APK Signature Scheme v2** (`APK Sig Block 42`, ID `0x7109871a`, 1 MB SHA-256 chunk Merkle tree)',
      '',
      'Verify with `apksigner verify --verbose --print-certs` either in the studio terminal or on your machine.',
    ].join('\n');
  }

  if (has('apk') || has('install') || has('run') || has('open the apk')) {
    return [
      '**Building & opening the APK**',
      '',
      '1. Run `gradle assembleDebug` or `gradle assembleRelease` (or click **Debug** / **Release** in the top bar).',
      '2. Each APK compiles a binary AXML `AndroidManifest.xml`, uncompressed 4-byte-aligned `resources.arsc`, executable Dalvik DEX `classes.dex` (`MainActivity` + `Bridge`), and signs with v1 + v2.',
      '3. The APK mounts automatically in the **Device** dock, or click **Open APK…** to inspect and launch any `.apk` file.',
      '4. Install on a real Android phone or AVD via `adb install -r app-release.apk`.',
    ].join('\n');
  }

  if (has('test')) {
    return [
      '**Unit Tests**',
      '',
      '- Run `gradle test` (or click **Test** in the top bar) to execute the JS test suite against `ForgeCore` and open the **Tests** tab.',
      '- JUnit XML and HTML reports are written to `app/build/test-results/testDebugUnitTest/TEST-ForgeDeck.xml` and bundled into the **Deliver** archive.',
    ].join('\n');
  }

  if (has('manifest') || has('permission') || has('activity')) {
    const manifest = ctx.files['app/src/main/AndroidManifest.xml'] ?? '(missing)';
    return [
      '**Manifest review**',
      '',
      `Package \`${ctx.config.applicationId}\`, minSdk ${ctx.config.minSdk}, targetSdk ${ctx.config.targetSdk}.`,
      ctx.problems.length
        ? `Open problems: ${ctx.problems.map((x) => x.message).join(' · ')}`
        : 'No problems detected by Android Lint.',
      '',
      '```xml',
      manifest.split('\n').slice(0, 24).join('\n'),
      '```',
    ].join('\n');
  }

  if (has('gradle') || has('maven') || has('toolchain')) {
    return [
      '**Studio Toolchain**',
      '',
      '- `gradle assembleDebug | assembleRelease | build | test | lint | clean`',
      '- `mvn package | mvn test | mvn clean`',
      '- `apksigner verify --print-certs`, `zipalign -c 4`, `unzip`, `sha256sum`, `adb install`',
      '',
      'Type `help` in the terminal for the full command list.',
    ].join('\n');
  }

  return [
    `**${ctx.config.label}** — ${fileCount} files, applicationId \`${ctx.config.applicationId}\`, version ${ctx.config.versionName}.`,
    '',
    ctx.activeFile ? `Editing \`${ctx.activeFile}\`.` : 'Select a file in the Explorer to inspect or edit.',
    '',
    'Ask me about:',
    '- building & v1+v2 signing (`gradle assembleRelease`)',
    '- running unit tests (`gradle test`) and Android lint (`gradle lint`)',
    '- inspecting APKs (`apksigner verify --print-certs`, `zipalign -c 4`)',
    '- delivering bundles or uploading to GoFile.io',
  ].join('\n');
}
