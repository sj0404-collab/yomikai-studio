import JSZip from 'jszip';
import { sha256Hex, type SigningKey } from './keys';
import type { ProjectConfig } from './project';
import { reportToHtml, reportToJUnitXml, type TestReport } from './tests';
import { decodeFileBytes, isDataUri, type FileMap } from './vfs';

export interface DeliveryResult {
  blob: Blob;
  fileName: string;
  sha256: string;
  size: number;
  entries: string[];
}

function buildDeliveryReadme(alias: string): string {
  return `# Forge Deck — delivery bundle

This archive was produced by **APKForge Studio**. It contains the signed installable APK
(verified with both JAR v1 and APK Signature Scheme v2), complete Gradle/Maven sources,
unit tests, and signing key material.

## Contents

| Path | Description |
| --- | --- |
| \`apk/\` | Installable Android APK (compiled binary AXML, uncompressed 4-byte aligned \`resources.arsc\`, Dalvik DEX 035, v1 + v2 signatures). |
| \`source/\` | Complete Gradle / Maven project workspace. |
| \`tests/\` | JUnit 4 sources, JavaScript test spec, and executed reports (JUnit XML + HTML). |
| \`keystore/\` | Signing key material (PKCS#8 PEM + X.509 PEM certificate). |
| \`build-log.txt\` | Full build output log. |

## Installing & verifying the APK right away

\`\`\`bash
apksigner verify --verbose --print-certs apk/*.apk
zipalign -c -v 4 apk/*.apk
adb install -r apk/*.apk
\`\`\`

## Reproducing natively with Gradle 8.7 + JDK 17 + Android SDK 34

\`\`\`bash
cd source
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# Convert exported PEM key + cert into PKCS#12 / JKS for Gradle release signing:
mkdir -p keystore
openssl pkcs12 -export \\
  -inkey ../keystore/${alias}.pk8.pem \\
  -in ../keystore/${alias}.cert.pem \\
  -name ${alias} \\
  -out keystore/release.p12 \\
  -passout pass:forge-release

keytool -importkeystore \\
  -srckeystore keystore/release.p12 -srcstoretype PKCS12 -srcstorepass forge-release \\
  -destkeystore keystore/release.jks -deststoretype JKS -deststorepass forge-release \\
  -alias ${alias} -noprompt

gradle assembleDebug
gradle assembleRelease
\`\`\`
`;
}

export async function createDeliveryZip(opts: {
  files: FileMap;
  config: ProjectConfig;
  apks: { name?: string; fileName?: string; blob: Blob; sha256: string; variant: string }[];
  report?: TestReport;
  buildLog: string | string[];
  key?: SigningKey | null;
  keys?: SigningKey[];
  templateName?: string;
}): Promise<DeliveryResult> {
  const zip = new JSZip();
  const root = `ForgeDeck-${opts.config.versionName}`;
  const entries: string[] = [];

  for (const apk of opts.apks) {
    const apkFileName = apk.name ?? apk.fileName ?? `${opts.config.applicationId}-${apk.variant}.apk`;
    const target = `${root}/apk/${apkFileName}`;
    zip.file(target, apk.blob);
    entries.push(target);
  }

  for (const [path, content] of Object.entries(opts.files)) {
    if (path.endsWith('/.keep')) continue;
    const target = `${root}/source/${path}`;
    if (isDataUri(content)) {
      zip.file(target, decodeFileBytes(content));
    } else {
      zip.file(target, content);
    }
    entries.push(target);
  }

  if (opts.report) {
    zip.file(`${root}/tests/TEST-ForgeDeck.xml`, reportToJUnitXml(opts.report));
    zip.file(`${root}/tests/report.html`, reportToHtml(opts.report));
    entries.push(`${root}/tests/TEST-ForgeDeck.xml`, `${root}/tests/report.html`);
  }

  for (const [path, content] of Object.entries(opts.files)) {
    if (path.startsWith('app/src/test/')) {
      const rel = path.replace('app/src/test/', '');
      zip.file(`${root}/tests/${rel}`, content);
      entries.push(`${root}/tests/${rel}`);
    }
  }

  const activeKey = opts.key ?? opts.keys?.[0] ?? null;
  const alias = activeKey?.alias ?? 'forge-release';

  if (activeKey) {
    zip.file(`${root}/keystore/${activeKey.alias}.pk8.pem`, activeKey.privateKeyPem);
    zip.file(`${root}/keystore/${activeKey.alias}.cert.pem`, activeKey.certificatePem);
    zip.file(
      `${root}/keystore/keystore.properties`,
      [
        `key.alias=${activeKey.alias}`,
        `key.store.password=${activeKey.storePassword}`,
        `key.password=${activeKey.keyPassword}`,
        `key.subject=${activeKey.subject}`,
        `key.fingerprint=${activeKey.fingerprintSha256}`,
        `key.created=${activeKey.createdAt}`,
        '',
        `# Convert PEM to PKCS#12 + JKS for Android Studio / Gradle:`,
        `# openssl pkcs12 -export -inkey ${activeKey.alias}.pk8.pem -in ${activeKey.alias}.cert.pem -name ${activeKey.alias} -out release.p12 -passout pass:forge-release`,
        `# keytool -importkeystore -srckeystore release.p12 -srcstoretype PKCS12 -srcstorepass forge-release -destkeystore release.jks -deststorepass forge-release -alias ${activeKey.alias}`,
      ].join('\n'),
    );
    entries.push(
      `${root}/keystore/${activeKey.alias}.pk8.pem`,
      `${root}/keystore/${activeKey.alias}.cert.pem`,
      `${root}/keystore/keystore.properties`,
    );
  }

  const logText = Array.isArray(opts.buildLog) ? opts.buildLog.join('\n') : opts.buildLog;
  zip.file(`${root}/build-log.txt`, logText || '(no build log captured)');
  zip.file(`${root}/README.md`, buildDeliveryReadme(alias));
  zip.file(
    `${root}/studio.json`,
    JSON.stringify(
      {
        tool: 'APKForge Studio',
        apkFormat: 'Binary AXML + ResTable + DEX 035 + JAR v1 + APK Sig v2',
        template: opts.templateName ?? 'webview',
        package: opts.config.applicationId,
        versionName: opts.config.versionName,
        versionCode: opts.config.versionCode,
        minSdk: opts.config.minSdk,
        targetSdk: opts.config.targetSdk,
        apks: opts.apks.map((a) => ({
          name: a.name ?? a.fileName ?? `${opts.config.applicationId}-${a.variant}.apk`,
          sha256: a.sha256,
          variant: a.variant,
        })),
        tests: opts.report
          ? { total: opts.report.total, passed: opts.report.passed, failed: opts.report.failed }
          : null,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  entries.push(`${root}/README.md`, `${root}/build-log.txt`, `${root}/studio.json`);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sha256 = await sha256Hex(bytes);

  return {
    blob,
    fileName: `${root}-${opts.apks[0]?.variant ?? 'debug'}-bundle.zip`,
    sha256,
    size: blob.size,
    entries,
  };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
