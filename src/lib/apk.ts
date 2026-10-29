import JSZip from 'jszip';
import { verifyApkBinary, writeAlignedApkZip, type ApkBinaryVerification, type ZipInputEntry } from './apksigv2';
import { buildLauncherIconPng, buildResourcesArsc, ICON_APK_PATH } from './arsc';
import { compileManifestAxml, inspectManifestBytes } from './axml';
import { buildDexAsync } from './dex';
import { buildManifest, buildPkcs7, buildSignatureFile, sha256Hex, type LoadedKey } from './keys';
import type { ProjectConfig } from './project';
import { decodeFileBytes, mimeForPath, type FileMap } from './vfs';

export interface ApkBuildResult {
  blob: Blob;
  fileName: string;
  sha256: string;
  size: number;
  entries: string[];
  signed: boolean;
  variant: 'debug' | 'release';
}

const UNCOMPRESSED_EXT = /\.(png|jpg|jpeg|webp|gif|mp3|mp4|ogg|wav|woff2)$/i;

export async function buildApk(opts: {
  files: FileMap;
  config: ProjectConfig;
  variant: 'debug' | 'release';
  key: LoadedKey | null;
}): Promise<ApkBuildResult> {
  const { files, config, variant, key } = opts;

  const isDebug = variant === 'debug';
  const effectivePackage =
    isDebug && !config.applicationId.endsWith('.debug')
      ? `${config.applicationId}.debug`
      : config.applicationId;
  const effectiveVersionName =
    isDebug && !config.versionName.endsWith('-debug') ? `${config.versionName}-debug` : config.versionName;

  const manifestXml = files['app/src/main/AndroidManifest.xml'] ?? '';
  const manifestAxml = compileManifestAxml({
    manifestXml,
    packageName: effectivePackage,
    namespace: config.namespace,
    versionCode: config.versionCode,
    versionName: effectiveVersionName,
    minSdk: config.minSdk,
    targetSdk: config.targetSdk,
    compileSdk: config.compileSdk,
    debuggable: isDebug,
  });

  const arsc = buildResourcesArsc({
    packageName: effectivePackage,
    appLabel: config.label,
  });

  const iconPng = await buildLauncherIconPng();

  const dex = await buildDexAsync({
    classDescriptor: `L${config.namespace.replace(/\./g, '/')}/MainActivity;`,
    superDescriptor: 'Landroid/app/Activity;',
    sourceFile: 'MainActivity.kt',
  });

  const zipEntries: ZipInputEntry[] = [
    { path: 'AndroidManifest.xml', data: manifestAxml },
    // Android 11+ (targetSdk >= 30) requires resources.arsc STORED uncompressed on a 4-byte boundary
    { path: 'resources.arsc', data: arsc, store: true },
    { path: ICON_APK_PATH, data: iconPng, store: true },
    { path: 'classes.dex', data: dex },
  ];

  const assetPrefix = 'app/src/main/assets/';
  const encoder = new TextEncoder();
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(assetPrefix)) {
      const target = `assets/${path.slice(assetPrefix.length)}`;
      if (target.endsWith('/.keep')) continue;
      zipEntries.push({
        path: target,
        data: decodeFileBytes(content),
        store: UNCOMPRESSED_EXT.test(target),
      });
    }
  }

  const meta = {
    toolchain: 'APKForge Studio (AAPT-AXML + DEX 035 + APK Sig v1/v2)',
    package: effectivePackage,
    namespace: config.namespace,
    versionName: effectiveVersionName,
    versionCode: config.versionCode,
    label: config.label,
    variant,
    minSdk: config.minSdk,
    targetSdk: config.targetSdk,
    entry: 'assets/webapp/index.html',
    builtAt: new Date().toISOString(),
    signature: key
      ? {
          schemes: ['v1 (JAR)', 'v2 (APK Sig Block 42)'],
          alias: key.alias,
          subject: key.subject,
          fingerprint: key.fingerprintSha256,
        }
      : null,
  };
  zipEntries.push({
    path: 'assets/apk-web.json',
    data: encoder.encode(JSON.stringify(meta, null, 2)),
  });

  // ---- v1 (JAR) signing + v2 (APK Sig Block 42) signing -------------------
  let signed = false;
  if (key) {
    const manifestText = await buildManifest(zipEntries.map((e) => ({ path: e.path, bytes: e.data })));
    const sfText = await buildSignatureFile(manifestText, true);
    const sfBytes = encoder.encode(sfText);
    const pkcs7 = await buildPkcs7(
      key.certificateDer,
      sfBytes,
      key.privateKey,
      key.subject,
      parseInt(key.serialHex, 16) || 1,
    );

    zipEntries.push(
      { path: 'META-INF/MANIFEST.MF', data: encoder.encode(manifestText) },
      { path: 'META-INF/CERT.SF', data: sfBytes },
      { path: 'META-INF/CERT.RSA', data: new Uint8Array(pkcs7) },
    );
    signed = true;
  }

  const apkBytes = await writeAlignedApkZip(zipEntries, signed ? key : null);
  const blob = new Blob([new Uint8Array(apkBytes).buffer as ArrayBuffer], {
    type: 'application/vnd.android.package-archive',
  });
  const sha256 = await sha256Hex(apkBytes);
  const fileName = `${config.applicationId}-${variant}.apk`;

  return {
    blob,
    fileName,
    sha256,
    size: apkBytes.length,
    entries: zipEntries.map((e) => e.path),
    signed,
    variant,
  };
}

export async function readApkEntry(blob: Blob, entryPath: string): Promise<string | null> {
  try {
    const zip = await JSZip.loadAsync(blob);
    const file = zip.file(entryPath);
    if (!file) return null;
    return await file.async('string');
  } catch {
    return null;
  }
}

export async function listApkEntries(blob: Blob): Promise<string[]> {
  try {
    const zip = await JSZip.loadAsync(blob);
    return Object.keys(zip.files).filter((k) => !zip.files[k].dir);
  } catch {
    return [];
  }
}

export async function extractApkAssets(blob: Blob): Promise<{
  text: Record<string, string>;
  mediaUrls: Record<string, string>;
  revokeAll: () => void;
}> {
  const text: Record<string, string> = {};
  const mediaUrls: Record<string, string> = {};
  const createdUrls: string[] = [];
  try {
    const zip = await JSZip.loadAsync(blob);
    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      if (path.startsWith('assets/webapp/')) {
        const rel = path.slice('assets/webapp/'.length);
        if (UNCOMPRESSED_EXT.test(rel)) {
          const bytes = await file.async('uint8array');
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: mimeForPath(rel) }),
          );
          mediaUrls[rel] = url;
          createdUrls.push(url);
        } else {
          text[rel] = await file.async('string');
        }
      }
    }
  } catch {
    /* invalid zip */
  }
  return {
    text,
    mediaUrls,
    revokeAll: () => createdUrls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

export interface InspectedApk {
  packageName: string;
  versionName: string;
  label: string;
  entries: string[];
  hasWebPayload: boolean;
  verification: ApkBinaryVerification;
}

/** Inspect any studio or third-party APK blob (binary AXML, web metadata, signatures, alignment). */
export async function inspectApkBlob(blob: Blob, fallbackName = 'uploaded.apk'): Promise<InspectedApk> {
  const raw = new Uint8Array(await blob.arrayBuffer());
  const verification = await verifyApkBinary(raw);

  let packageName = fallbackName.replace(/\.apk$/i, '');
  let versionName = '1.0.0';
  let label = packageName;
  let entries: string[] = [];
  let hasWebPayload = false;

  try {
    const zip = await JSZip.loadAsync(raw);
    entries = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
    hasWebPayload = entries.some((e) => e === 'assets/webapp/index.html');

    const webMetaFile = zip.file('assets/apk-web.json') ?? zip.file('apk-web.json');
    if (webMetaFile) {
      const meta = JSON.parse(await webMetaFile.async('string')) as {
        package?: string;
        versionName?: string;
        label?: string;
      };
      if (meta.package) packageName = meta.package;
      if (meta.versionName) versionName = meta.versionName;
      if (meta.label) label = meta.label;
    }

    const manifestFile = zip.file('AndroidManifest.xml');
    if (manifestFile) {
      const mBytes = await manifestFile.async('uint8array');
      const decoded = inspectManifestBytes(mBytes);
      if (decoded.packageName) packageName = decoded.packageName;
      if (decoded.versionName) versionName = decoded.versionName;
    }
  } catch {
    /* non-zip or corrupted */
  }

  return {
    packageName,
    versionName,
    label,
    entries,
    hasWebPayload,
    verification,
  };
}
