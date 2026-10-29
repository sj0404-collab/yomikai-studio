import { isDataUri, type FileMap } from './vfs';

export interface Problem {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  source: string;
}

export interface ProjectConfig {
  applicationId: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  compileSdk: number;
  namespace: string;
  label: string;
  dependencies: string[];
  signingConfig: string;
  hasManifest: boolean;
  hasWebPayload: boolean;
  kotlinFiles: number;
  javaFiles: number;
  resourceFiles: number;
}

const KNOWN_DEPENDENCIES = [
  'androidx.core:core-ktx',
  'androidx.activity',
  'androidx.appcompat:appcompat',
  'androidx.webkit:webkit',
  'androidx.compose',
  'androidx.lifecycle',
  'com.google.android.material:material',
  'org.jetbrains.kotlinx:kotlinx-coroutines-android',
  'junit:junit',
  'androidx.test.ext:junit',
  'com.squareup.retrofit2:retrofit',
  'com.squareup.okhttp3:okhttp',
  'io.coil-kt:coil',
];

function gradleValue(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1];
}

function gradleNumber(source: string, key: string): number | undefined {
  const match = source.match(new RegExp(`${key}\\s*=\\s*(\\d+)`));
  return match ? parseInt(match[1], 10) : undefined;
}

export function parseProject(files: FileMap): { config: ProjectConfig; problems: Problem[] } {
  const problems: Problem[] = [];
  const gradle = files['app/build.gradle.kts'] ?? '';
  const manifest = files['app/src/main/AndroidManifest.xml'];
  const strings = files['app/src/main/res/values/strings.xml'] ?? '';

  const deps: string[] = [];
  const depRe = /(?:implementation|api|testImplementation|androidTestImplementation)\("([^"]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = depRe.exec(gradle))) deps.push(m[1]);

  const labelMatch = strings.match(/<string name="app_name">([^<]+)<\/string>/);
  const manifestPkgMatch = manifest?.match(/\spackage\s*=\s*["']([^"']+)["']/);

  const namespace = gradleValue(gradle, 'namespace') ?? manifestPkgMatch?.[1] ?? 'com.forge.droid';
  const applicationId = gradleValue(gradle, 'applicationId') ?? namespace;

  const config: ProjectConfig = {
    applicationId,
    versionName: gradleValue(gradle, 'versionName') ?? '1.0.0',
    versionCode: gradleNumber(gradle, 'versionCode') ?? 1,
    minSdk: gradleNumber(gradle, 'minSdk') ?? 24,
    targetSdk: gradleNumber(gradle, 'targetSdk') ?? 34,
    compileSdk: gradleNumber(gradle, 'compileSdk') ?? 34,
    namespace,
    label: labelMatch?.[1] ?? 'Forge Deck',
    dependencies: deps,
    signingConfig: gradle.includes('signingConfigs') ? 'release' : 'debug',
    hasManifest: Boolean(manifest),
    hasWebPayload: Object.keys(files).some((p) => p.startsWith('app/src/main/assets/webapp/')),
    kotlinFiles: Object.keys(files).filter((p) => p.endsWith('.kt')).length,
    javaFiles: Object.keys(files).filter((p) => p.endsWith('.java') && !p.includes('/test/')).length,
    resourceFiles: Object.keys(files).filter((p) => p.startsWith('app/src/main/res/')).length,
  };

  if (!manifest) {
    problems.push({
      severity: 'error',
      message: 'AndroidManifest.xml is missing — the APK cannot be packaged.',
      file: 'app/src/main/AndroidManifest.xml',
      source: 'manifest',
    });
  } else {
    if (/android:exported\s*=\s*"true"/.test(manifest) === false && /<activity/.test(manifest)) {
      problems.push({
        severity: 'warning',
        message: 'Activity without android:exported — required for targetSdk 31+.',
        file: 'app/src/main/AndroidManifest.xml',
        source: 'manifest',
      });
    }
    if (/\spackage\s*=/.test(manifest)) {
      problems.push({
        severity: 'warning',
        message: 'The package attribute in AndroidManifest.xml is removed in AGP 8+ — use namespace in build.gradle.kts.',
        file: 'app/src/main/AndroidManifest.xml',
        source: 'manifest',
      });
    }
    const hasNetCall = Object.values(files).some(
      (v) => !isDataUri(v) && /fetch\(|XMLHttpRequest/.test(v),
    );
    if (!/android\.permission\.INTERNET/.test(manifest) && hasNetCall) {
      problems.push({
        severity: 'info',
        message: 'The payload performs network calls but INTERNET permission is not declared.',
        file: 'app/src/main/AndroidManifest.xml',
        source: 'manifest',
      });
    }
  }

  if (config.minSdk < 24) {
    problems.push({
      severity: 'info',
      message: `minSdk ${config.minSdk} is below 24 — APK Signature Scheme v2 requires API 24+ (v1 fallback included).`,
      file: 'app/build.gradle.kts',
      source: 'gradle',
    });
  }

  for (const dep of deps) {
    const known = KNOWN_DEPENDENCIES.some((k) => dep.startsWith(k));
    if (!known) {
      problems.push({
        severity: 'warning',
        message: `Could not resolve "${dep}" from the offline repository mirror.`,
        file: 'app/build.gradle.kts',
        source: 'gradle',
      });
    }
  }

  if (!config.hasWebPayload) {
    problems.push({
      severity: 'warning',
      message: 'No web payload under app/src/main/assets/webapp — the emulator will show an empty shell.',
      source: 'assets',
    });
  }

  if (!gradle) {
    problems.push({
      severity: 'error',
      message: 'app/build.gradle.kts is missing.',
      file: 'app/build.gradle.kts',
      source: 'gradle',
    });
  }

  return { config, problems };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
