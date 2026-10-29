import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, X } from 'lucide-react';
import { Markdown } from './Markdown';
import { useStudio } from '../lib/studio';

interface Section {
  heading: string;
  body: string;
}

const RU: { title: string; intro: string; sections: Section[] } = {
  title: 'Сборка и запуск APK',
  intro:
    'Студия собирает APK прямо в браузере на wasm64-песочнице (x86_64 ABI поверх WebAssembly). Ниже — как повторить то же самое нативно и как открыть готовый APK.',
  sections: [
    {
      heading: '1. Что внутри студии',
      body: `- **Редактор** — Monaco (VS Code), подсветка Kotlin/Java/Gradle/XML/JS.
- **Терминал** — настоящие команды: \`gradle\`, \`mvn\`, \`keytool\`, \`apksigner\`, \`adb\`, \`unzip\`, \`sha256sum\`, \`opencode\`.
- **Сборка** — \`assembleDebug\`, \`assembleRelease\`, \`test\`, \`lint\`, \`clean\`, \`mvn package\`.
- **Эмулятор** — запускает сам APK (без образа Android-системы): payload из \`assets/webapp\` рендерится в iframe с мостом \`window.Android\`.
- **OpenCode** — встроенная панель агента; подключается к \`opencode serve\` или любому OpenAI-совместимому эндпоинту.
- **Доставка** — ZIP (APK + исходники + тесты + ключ) и выгрузка на GoFile.io.`,
    },
    {
      heading: '2. Нативный тулчейн',
      body: `Нужен **JDK 17**, **Android SDK 34** и **Gradle 8.7** (или Maven 3.9).

\`\`\`bash
# JDK
sudo apt install openjdk-17-jdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# Android SDK
mkdir -p $ANDROID_HOME/cmdline-tools && cd $ANDROID_HOME/cmdline-tools
curl -O https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-*.zip && mv cmdline-tools latest
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin

sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
export ANDROID_HOME=$ANDROID_HOME

# Gradle / Maven
sdkmanager --list   # доступные версии
sudo apt install gradle maven   # или скачайте 8.7 / 3.9.6
\`\`\`

Дальше проект открывается в Android Studio (File → Open → папка проекта) и собирается кнопкой Run.`,
    },
    {
      heading: '3. Ключи: дебаг и релиз',
      body: `Debug-ключ Android уже есть в каждом SDK (\`~/.android/debug.keystore\`, alias \`androiddebugkey\`, пароль \`android\`).
Релизный ключ создаётся один раз и хранится в безопасном месте:

\`\`\`bash
keytool -genkeypair -v -keystore keystore/release.jks -alias forge-release \\
        -keyalg RSA -keysize 2048 -validity 10000
\`\`\`

В Gradle:

\`\`\`kotlin
signingConfigs {
    create("release") {
        storeFile = file("../keystore/release.jks")
        storePassword = System.getenv("FORGE_STORE_PASSWORD")
        keyAlias = "forge-release"
        keyPassword = System.getenv("FORGE_KEY_PASSWORD")
    }
}
\`\`\`

В студии то же самое делается в панели **Signing keys**: ключ генерируется через WebCrypto (RSA-2048, X.509v3 \`digitalSignature\`), а APK получает двойную криптографическую подпись **JAR v1** (\`META-INF/MANIFEST.MF\`, \`CERT.SF\`, \`CERT.RSA\`) и **APK Signature Scheme v2** (\`APK Sig Block 42\`, ID \`0x7109871a\`). Проверка:

\`\`\`bash
apksigner verify --verbose --print-certs app-release.apk
zipalign -c -v 4 app-release.apk
\`\`\``,
    },
    {
      heading: '4. Сборка',
      body: `\`\`\`bash
gradle assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
gradle assembleRelease    # подписанный релиз
gradle test               # юнит-тесты
mvn -f maven/pom.xml package
\`\`\`

Артефакты, собранные в студии, лежат в \`app/build/outputs/apk/<variant>/\` и в панели **Build** — их можно скачать или сразу установить в эмулятор.`,
    },
    {
      heading: '5. Запуск APK',
      body: `**Вариант 1 — эмулятор студии (только приложение, без образа системы).**
Откройте панель **Device**, нажмите *Install APK*. Эмулятор показывает ровно то, что покажет приложение.

**Вариант 2 — веб-эмулятор appetizer.io.**
Откройте https://appetizer.io/upload и перетащите APK — он запустится в настоящем Android-эмуляторе в облаке.

**Вариант 3 — локальный AVD или устройство.**

\`\`\`bash
sdkmanager "emulator" "system-images;android-34;google_apis;x86_64"
avdmanager create avd -n forge_pixel34 -k "system-images;android-34;google_apis;x86_64"
emulator -avd forge_pixel34 &
adb install -r app-debug.apk
adb shell am start -n com.forge.droid/.MainActivity
\`\`\``,
    },
    {
      heading: '6. wasm64: нативные бинарники в браузере',
      body: `Схема «x86_64 → WebAssembly» позволяет запускать в браузере настоящие JDK, Gradle, Maven и Android SDK:

- **WebVM / CheerpX** — полноценный Debian/Alpine в браузере с x86-64 JIT-компиляцией.
- **container2wasm** — контейнеры Linux, собранные в WASI-образ (NTT).
- **ax** — минимальный x86-64 эмулятор на WebAssembly.
- **Emscripten** — если нужен свой порт бинарника.

Студия повторяет этот сценарий в браузере: окружение (JDK 17, Gradle 8.7, Maven, SDK 34, keytool, apksigner) имитируется, а настоящая работа — упаковка APK, генерация DEX-контейнера, криптографическая подпись и запуск приложения в браузере.`,
    },
    {
      heading: '7. OpenCode',
      body: `\`\`\`bash
# установка
curl -fsSL https://opencode.ai/install | bash
npm i -g @opencode/cli@latest      # альтернатива

# запустить сервер для встроенной панели
opencode serve --port 4096
\`\`\`

В панели **OpenCode** укажите endpoint \`http://127.0.0.1:4096/v1\` и модель (\`opencode/big\`). Панель умеет стримить ответы по OpenAI-совместимому API; если эндпоинт недоступен, работает встроенный офлайн-ассистент. У OpenCode также есть расширение для VS Code и десктоп-приложение.`,
    },
    {
      heading: '8. Доставка результата',
      body: `Кнопка **Deliver** собирает ZIP: \`apk/\` (подписанный APK), \`source/\` (весь проект), \`tests/\` (JUnit-исходники, JS-зеркало тестов, отчёт), \`keystore/\` (PKCS#8 + сертификат), \`build-log.txt\` и \`README.md\`. ZIP скачивается напрямую или выгружается на **gofile.io** — ссылка появляется в модальном окне.`,
    },
    {
      heading: '9. Как устроен бинарный APK из браузера',
      body: `Браузерная сборка создаёт полноценный установочный Android APK: бинарный AXML \`AndroidManifest.xml\` (\`0x00080003\`), несжатый и выровненный по 4 байтам \`resources.arsc\` (\`ResTable\`), исполняемый Dalvik байткод \`classes.dex\` (\`035\`, \`MainActivity\` + \`Bridge\` с \`WebView\`) и двойную подпись **v1 + APK Signature Scheme v2** через WebCrypto.

Для сложных нативных Kotlin/Compose-проектов экспортируйте архив через **Deliver** и запустите \`gradle assembleRelease\` на локальном JDK 17 + Android SDK 34.`,
    },
  ],
};

const EN: { title: string; intro: string; sections: Section[] } = {
  title: 'Building and running the APK',
  intro:
    'The studio packages APKs in the browser on a wasm64 sandbox (x86_64 ABI on top of WebAssembly). Below is how to repeat the same steps natively and how to open the finished APK.',
  sections: [
    {
      heading: '1. What is inside the studio',
      body: `- **Editor** — Monaco (VS Code) with Kotlin/Java/Gradle/XML/JS support.
- **Terminal** — real commands: \`gradle\`, \`mvn\`, \`keytool\`, \`apksigner\`, \`adb\`, \`unzip\`, \`sha256sum\`, \`opencode\`.
- **Build** — \`assembleDebug\`, \`assembleRelease\`, \`test\`, \`lint\`, \`clean\`, \`mvn package\`.
- **Emulator** — boots the APK itself (no Android system image): the \`assets/webapp\` payload renders inside an iframe with a \`window.Android\` bridge.
- **OpenCode** — embedded agent panel; point it at \`opencode serve\` or any OpenAI-compatible endpoint.
- **Delivery** — a ZIP (APK + sources + tests + key) and a GoFile.io upload.`,
    },
    {
      heading: '2. Native toolchain',
      body: `You need **JDK 17**, the **Android SDK 34** and **Gradle 8.7** (or Maven 3.9).

\`\`\`bash
sudo apt install openjdk-17-jdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

mkdir -p $ANDROID_HOME/cmdline-tools && cd $ANDROID_HOME/cmdline-tools
curl -O https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-*.zip && mv cmdline-tools latest
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

sudo apt install gradle maven
\`\`\`

Open the project in Android Studio (File → Open) and press Run.`,
    },
    {
      heading: '3. Debug and release keys',
      body: `Every SDK ships a debug key (\`~/.android/debug.keystore\`, alias \`androiddebugkey\`, password \`android\`).
Create a release key once and keep it safe:

\`\`\`bash
keytool -genkeypair -v -keystore keystore/release.jks -alias forge-release \\
        -keyalg RSA -keysize 2048 -validity 10000
\`\`\`

The studio does the same in the **Signing keys** panel: RSA-2048 via WebCrypto and a real v1 signature (\`META-INF/MANIFEST.MF\`, \`CERT.SF\`, PKCS#7 \`CERT.RSA\`). Verify with \`apksigner verify --print-certs\`.`,
    },
    {
      heading: '4. Building',
      body: `\`\`\`bash
gradle assembleDebug
gradle assembleRelease
gradle test
mvn -f maven/pom.xml package
\`\`\`

Artifacts land in \`app/build/outputs/apk/<variant>/\` and in the **Build** panel — download them or install them into the emulator in one click.`,
    },
    {
      heading: '5. Opening the APK',
      body: `**Studio emulator (app only, no system image).** Open the **Device** dock and press *Install APK*.

**appetizer.io (web emulator).** Open https://appetizer.io/upload and drop the APK in — it streams inside a real cloud Android emulator.

**Local AVD or device.**

\`\`\`bash
sdkmanager "emulator" "system-images;android-34;google_apis;x86_64"
avdmanager create avd -n forge_pixel34 -k "system-images;android-34;google_apis;x86_64"
emulator -avd forge_pixel34 &
adb install -r app-debug.apk
adb shell am start -n com.forge.droid/.MainActivity
\`\`\``,
    },
    {
      heading: '6. wasm64: native binaries in the browser',
      body: `- **WebVM / CheerpX** — a full Debian/Alpine in the browser with an x86-64 JIT.
- **container2wasm** — Linux containers compiled to a WASI image (NTT).
- **ax** — a minimal x86-64 emulator on WebAssembly.
- **Emscripten** — port your own binary.

The studio mirrors that model: the environment (JDK 17, Gradle 8.7, Maven, SDK 34, keytool, apksigner) is emulated, while the real work — APK packaging, DEX container generation, cryptographic signing and running the app — happens for real in the browser.`,
    },
    {
      heading: '7. OpenCode',
      body: `\`\`\`bash
curl -fsSL https://opencode.ai/install | bash
npm i -g @opencode/cli@latest

opencode serve --port 4096
\`\`\`

Point the **OpenCode** panel at \`http://127.0.0.1:4096/v1\`. It streams over the OpenAI-compatible API and falls back to the built-in offline assistant when no endpoint answers. OpenCode also ships a VS Code extension and a desktop app.`,
    },
    {
      heading: '8. Delivering the result',
      body: `**Deliver** packs a ZIP: \`apk/\` (signed APK), \`source/\` (the whole project), \`tests/\` (JUnit sources, the JS mirror, the report), \`keystore/\` (PKCS#8 + certificate), \`build-log.txt\` and \`README.md\`. Download it locally or upload it to **gofile.io** — the link shows up in the modal.`,
    },
    {
      heading: '9. Honest limitations',
      body: `The browser build is a real APK container: a valid \`classes.dex\` (proper DEX header, tables, map_list), \`AndroidManifest.xml\`, resources and a WebCrypto-generated v1 signature. The interactive part of the app is a WebView shell around \`assets/webapp\`, so exactly the same code runs in the studio emulator and on a physical device.

A native build (\`gradle assembleRelease\` on a real JDK) compiles Kotlin/Java into a genuine DEX and packs resources with AAPT — that is the mode to use for production.`,
    },
  ],
};

export function DocsModal() {
  const { docsOpen, setDocsOpen } = useStudio();
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const open = docsOpen;
  const setOpen = setDocsOpen;
  const doc = lang === 'ru' ? RU : EN;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-[min(820px,95vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
              <BookOpen size={16} className="text-[var(--accent)]" />
              <div className="text-[13.5px] font-semibold text-[var(--text)]">{doc.title}</div>
              <div className="ml-auto flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
                {(['ru', 'en'] as const).map((code) => (
                  <button
                    key={code}
                    onClick={() => setLang(code)}
                    className={`rounded-md px-2 py-1 text-[11px] uppercase ${
                      lang === code ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--muted)]'
                    }`}
                  >
                    {code}
                  </button>
                ))}
              </div>
              <button onClick={() => setOpen(false)} className="icon-btn ml-1">
                <X size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <p className="text-[13px] leading-relaxed text-[var(--muted)]">{doc.intro}</p>
              {doc.sections.map((section) => (
                <section key={section.heading}>
                  <h3 className="mb-1.5 text-[12.5px] font-semibold text-[var(--text)]">{section.heading}</h3>
                  <div className="text-[var(--muted)]">
                    <Markdown text={section.body} />
                  </div>
                </section>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
