import { WEB_APP_JS, WEB_CORE_JS, WEB_INDEX_HTML, WEB_STYLE_CSS } from './webapp';
import type { FileMap } from './vfs';

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  badge: string;
}

export const TEMPLATES: TemplateMeta[] = [
  {
    id: 'webview',
    name: 'Kotlin WebView Shell',
    description: 'Material web app hosted in a Kotlin WebView shell. Builds to an installable v1+v2 signed APK.',
    badge: 'Kotlin',
  },
  {
    id: 'compose',
    name: 'Jetpack Compose Counter',
    description: 'Compose Material3 project with matching web runtime payload for instant preview and APK packaging.',
    badge: 'Compose',
  },
  {
    id: 'maven',
    name: 'Maven WebView Service',
    description: 'Android WebView shell configured with a Maven POM (`mvn package` / `mvn test` ready).',
    badge: 'Maven',
  },
];

const GRADLE_PROPS = `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.caching=true
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`;

const SETTINGS_GRADLE = `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ForgeDroid"
include(":app")
`;

const ROOT_GRADLE = `plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
`;

const APP_GRADLE = `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.forge.droid"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.forge.droid"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            storeFile = file("../keystore/release.jks")
            storePassword = System.getenv("FORGE_STORE_PASSWORD") ?: "forge-release"
            keyAlias = "forge-release"
            keyPassword = System.getenv("FORGE_KEY_PASSWORD") ?: "forge-release"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
`;

const COMPOSE_APP_GRADLE = `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.forge.droid"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.forge.droid"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    signingConfigs {
        create("release") {
            storeFile = file("../keystore/release.jks")
            storePassword = System.getenv("FORGE_STORE_PASSWORD") ?: "forge-release"
            keyAlias = "forge-release"
            keyPassword = System.getenv("FORGE_KEY_PASSWORD") ?: "forge-release"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.compose.ui:ui:1.6.8")
    implementation("androidx.compose.material3:material3:1.2.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
`;

const PROGUARD = `# Keep the WebView bridge reachable from JavaScript.
-keepclassmembers class com.forge.droid.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
`;

// AGP 8+ compliant AndroidManifest.xml (namespace is declared in app/build.gradle.kts)
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.ForgeDroid">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

const MAIN_ACTIVITY = `package com.forge.droid

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity

class MainActivity : ComponentActivity() {

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = true
        web.addJavascriptInterface(Bridge(this), "Android")
        web.webViewClient = ForgeWebViewClient()

        web.loadUrl("file:///android_asset/webapp/index.html")
        setContentView(web)
    }
}
`;

const BRIDGE = `package com.forge.droid

import android.app.Activity
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast

/**
 * Mirrors the \`window.Android\` surface injected by the in-browser emulator so the
 * same JavaScript runs unchanged on a physical device.
 */
class Bridge(private val activity: Activity) {

    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun log(message: String) {
        Log.i("ForgeDeck", message)
    }

    @JavascriptInterface
    fun vibrate(durationMs: Long) {
        val vibrator = activity.getSystemService(Activity.VIBRATOR_SERVICE) as Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(durationMs)
        }
    }

    @JavascriptInterface
    fun finish() {
        activity.runOnUiThread { activity.finish() }
    }
}
`;

const WEB_CLIENT = `package com.forge.droid

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

class ForgeWebViewClient : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false

    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? = null
}
`;

const LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:fitsSystemWindows="true"
    android:background="@color/forge_background">

    <WebView
        android:id="@+id/webView"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />
</FrameLayout>
`;

const STRINGS = `<resources>
    <string name="app_name">Forge Deck</string>
    <string name="webview_missing">Web payload missing from assets/webapp</string>
</resources>
`;

const THEMES = `<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.ForgeDroid" parent="android:Theme.Material.NoActionBar">
        <item name="android:statusBarColor">@color/forge_background</item>
        <item name="android:navigationBarColor">@color/forge_background</item>
        <item name="android:windowBackground">@color/forge_background</item>
        <item name="android:windowLightStatusBar" tools:targetApi="m">false</item>
    </style>
</resources>
`;

const COLORS = `<resources>
    <color name="forge_background">#FF0B0F14</color>
    <color name="forge_accent">#FF3DDC84</color>
    <color name="forge_surface">#FF141A21</color>
</resources>
`;

const ICON_FOREGROUND = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#3DDC84"
        android:pathData="M54,26 L76,40 L76,68 L54,82 L32,68 L32,40 Z" />
    <path
        android:fillColor="#0B0F14"
        android:pathData="M58,38 L44,58 L52,58 L48,72 L64,50 L55,50 Z" />
</vector>
`;

const ICON_ADAPTIVE = `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/forge_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;

const JUNIT_TEST = `package com.forge.droid;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Native unit test — run it with \`gradle test\` on a real JDK, or through the
 * browser test runner which executes the mirrored JavaScript spec.
 */
public class ConverterTest {

    @Test
    public void celsiusToFahrenheit() {
        assertEquals(32.0, Converter.cToF(0.0), 0.0001);
    }

    @Test
    public void boilingPoint() {
        assertEquals(212.0, Converter.cToF(100.0), 0.0001);
    }

    @Test
    public void fahrenheitToCelsius() {
        assertEquals(100.0, Converter.fToC(212.0), 0.0001);
    }
}
`;

const CONVERTER = `package com.forge.droid;

/** Mirrors \`ForgeCore\` from assets/webapp/lib/core.js. */
public final class Converter {

    private Converter() {
    }

    public static double cToF(double celsius) {
        return (celsius * 9.0 / 5.0) + 32.0;
    }

    public static double fToC(double fahrenheit) {
        return (fahrenheit - 32.0) * 5.0 / 9.0;
    }
}
`;

const JS_TEST = `// Browser-side mirror of the JUnit suite. Executed by the in-studio test runner.
describe('ForgeCore', function () {
  test('cToF converts 0C to 32F', function () {
    expect(ForgeCore.cToF(0)).toBe(32);
  });

  test('cToF converts 100C to 212F', function () {
    expect(ForgeCore.cToF(100)).toBe(212);
  });

  test('fToC converts 212F back to 100C', function () {
    expect(ForgeCore.fToC(212)).toBeCloseTo(100, 5);
  });

  test('bump applies a delta', function () {
    expect(ForgeCore.bump(41, 1)).toBe(42);
  });

  test('checksum is stable and 8 chars', function () {
    expect(ForgeCore.checksum('apkforge')).toBe(ForgeCore.checksum('apkforge'));
    expect(ForgeCore.checksum('apkforge').length).toBe(8);
  });

  test('versionCode encodes semver', function () {
    expect(ForgeCore.versionCode('1.2.3')).toBe(10203);
  });
});
`;

function makeMavenPom(relPrefix: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.forge.droid</groupId>
    <artifactId>forge-droid</artifactId>
    <version>1.0.0</version>
    <packaging>apk</packaging>

    <properties>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <android.sdk.version>34</android.sdk.version>
    </properties>

    <build>
        <sourceDirectory>\${project.basedir}/${relPrefix}app/src/main/java</sourceDirectory>
        <resources>
            <resource>
                <directory>\${project.basedir}/${relPrefix}app/src/main/res</directory>
            </resource>
            <resource>
                <directory>\${project.basedir}/${relPrefix}app/src/main/assets</directory>
            </resource>
        </resources>
        <plugins>
            <plugin>
                <groupId>com.simpligility.maven.plugins</groupId>
                <artifactId>android-maven-plugin</artifactId>
                <version>4.6.0</version>
                <extensions>true</extensions>
                <configuration>
                    <sdkDirectory>\${env.ANDROID_HOME}</sdkDirectory>
                    <manifestFile>\${project.basedir}/${relPrefix}app/src/main/AndroidManifest.xml</manifestFile>
                    <zipalign>true</zipalign>
                    <signing>
                        <keystore>\${project.basedir}/${relPrefix}keystore/release.jks</keystore>
                        <storepass>forge-release</storepass>
                        <keyalias>forge-release</keyalias>
                        <keypass>forge-release</keypass>
                    </signing>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.2.5</version>
            </plugin>
        </plugins>
    </build>

    <dependencies>
        <dependency>
            <groupId>junit</groupId>
            <artifactId>junit</artifactId>
            <version>4.13.2</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
`;
}

const GITIGNORE = `*.iml
.gradle
/local.properties
/.idea
/build
/captures
.externalNativeBuild
.cxx
`;

const README = `# Forge Deck

A Kotlin WebView shell packaged into an installable v1+v2 signed Android APK.

## Build in the browser

1. Open the **Build** tab in the activity bar and pick a variant.
2. Press **Build debug** or **Build release** (compiles binary AXML, uncompressed \`resources.arsc\`, Dalvik DEX 035, and signs with JAR v1 + APK Signature Scheme v2).
3. Open **Deliver** to download the bundle ZIP or upload it to GoFile.io.

## Build natively

\`\`\`bash
sdkmanager "platforms;android-34" "build-tools;34.0.0"
mkdir -p keystore
keytool -genkeypair -v -keystore keystore/release.jks -alias forge-release \\
        -keyalg RSA -keysize 2048 -validity 10000 \\
        -storepass forge-release -keypass forge-release \\
        -dname "CN=APKForge, O=APKForge, C=US"
gradle assembleDebug
gradle assembleRelease
\`\`\`
`;

function webAssets(prefix: string): FileMap {
  return {
    [`${prefix}app/src/main/assets/webapp/index.html`]: WEB_INDEX_HTML,
    [`${prefix}app/src/main/assets/webapp/style.css`]: WEB_STYLE_CSS,
    [`${prefix}app/src/main/assets/webapp/app.js`]: WEB_APP_JS,
    [`${prefix}app/src/main/assets/webapp/lib/core.js`]: WEB_CORE_JS,
  };
}

export function createTemplate(id: string): FileMap {
  const files: FileMap = {
    'settings.gradle.kts': SETTINGS_GRADLE,
    'build.gradle.kts': ROOT_GRADLE,
    'gradle.properties': GRADLE_PROPS,
    'app/build.gradle.kts': APP_GRADLE,
    'app/proguard-rules.pro': PROGUARD,
    'app/src/main/AndroidManifest.xml': MANIFEST,
    'app/src/main/java/com/forge/droid/MainActivity.kt': MAIN_ACTIVITY,
    'app/src/main/java/com/forge/droid/Bridge.kt': BRIDGE,
    'app/src/main/java/com/forge/droid/ForgeWebViewClient.kt': WEB_CLIENT,
    'app/src/main/java/com/forge/droid/Converter.java': CONVERTER,
    'app/src/main/res/layout/activity_main.xml': LAYOUT,
    'app/src/main/res/values/strings.xml': STRINGS,
    'app/src/main/res/values/themes.xml': THEMES,
    'app/src/main/res/values/colors.xml': COLORS,
    'app/src/main/res/drawable/ic_launcher_foreground.xml': ICON_FOREGROUND,
    'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml': ICON_ADAPTIVE,
    'app/src/test/java/com/forge/droid/ConverterTest.java': JUNIT_TEST,
    'app/src/test/js/core.test.js': JS_TEST,
    'maven/pom.xml': makeMavenPom('../'),
    '.gitignore': GITIGNORE,
    'README.md': README,
    ...webAssets(''),
  };

  if (id === 'compose') {
    files['app/build.gradle.kts'] = COMPOSE_APP_GRADLE;
    files['app/src/main/java/com/forge/droid/MainActivity.kt'] = `package com.forge.droid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface { Text("Forge Deck — Compose shell") }
            }
        }
    }
}
`;
    files['app/src/main/assets/webapp/index.html'] = WEB_INDEX_HTML.replace(
      '<h1>Forge Deck</h1>',
      '<h1>Forge Deck Compose</h1>',
    );
  }

  if (id === 'maven') {
    files['pom.xml'] = makeMavenPom('');
    files['app/build.gradle.kts'] = APP_GRADLE.replace(
      'signingConfig = signingConfigs.getByName("release")',
      'signingConfig = signingConfigs.getByName("release") // maven build uses pom.xml',
    );
  }

  return files;
}
