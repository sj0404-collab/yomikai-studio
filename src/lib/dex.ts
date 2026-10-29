// Genuine Dalvik Executable (DEX 035) bytecode assembler for APKForge Studio.
//
// Emits two real Android classes with executable Dalvik bytecode:
//   1. <namespace>.Bridge  — @JavascriptInterface methods showToast(String),
//      log(String) and deviceInfo() backed by android.widget.Toast and android.util.Log.
//   2. <namespace>.MainActivity extends android.app.Activity — <init>()V and
//      onCreate(Bundle)V instantiating android.webkit.WebView, enabling JS & DOM
//      storage, wiring Bridge as `window.Android`, and loading
//      `file:///android_asset/webapp/index.html`.
//
// All DEX tables (string_ids, type_ids, proto_ids, field_ids, method_ids,
// class_defs) and map_list follow strict AOSP DexFileVerifier ordering rules.

const TYPE_HEADER_ITEM = 0x0000;
const TYPE_STRING_ID_ITEM = 0x0001;
const TYPE_TYPE_ID_ITEM = 0x0002;
const TYPE_PROTO_ID_ITEM = 0x0003;
const TYPE_FIELD_ID_ITEM = 0x0004;
const TYPE_METHOD_ID_ITEM = 0x0005;
const TYPE_CLASS_DEF_ITEM = 0x0006;
const TYPE_MAP_LIST = 0x1000;
const TYPE_TYPE_LIST = 0x1001;
const TYPE_ANNOTATION_SET_ITEM = 0x1003;
const TYPE_CLASS_DATA_ITEM = 0x2000;
const TYPE_CODE_ITEM = 0x2001;
const TYPE_STRING_DATA_ITEM = 0x2002;
const TYPE_ANNOTATION_ITEM = 0x2004;
const TYPE_ANNOTATIONS_DIRECTORY_ITEM = 0x2006;

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function uleb128(v: number): number[] {
  const out: number[] = [];
  let value = v >>> 0;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    out.push(byte);
  } while (value !== 0);
  return out;
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

function utf16Size(str: string): number {
  let size = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    size += code > 0xffff ? 2 : 1;
  }
  return size;
}

function compareModifiedUtf8(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return ca - cb;
  }
  return a.length - b.length;
}

export interface DexOptions {
  classDescriptor: string; // e.g. Lcom/forge/droid/MainActivity;
  superDescriptor?: string; // defaults to Landroid/app/Activity;
  sourceFile?: string; // defaults to MainActivity.kt
  assetEntryUrl?: string; // defaults to file:///android_asset/webapp/index.html
}

interface ProtoSpec {
  key: string;
  shorty: string;
  returnType: string;
  params: string[];
}

interface FieldSpec {
  classDesc: string;
  typeDesc: string;
  name: string;
}

interface MethodSpec {
  key: string;
  classDesc: string;
  protoKey: string;
  name: string;
}

function buildCodeItem(opts: {
  registers: number;
  ins: number;
  outs: number;
  insns: number[]; // flat byte array of 16-bit code units
}): number[] {
  const insnsUnits = opts.insns.length / 2;
  return [
    ...u16(opts.registers),
    ...u16(opts.ins),
    ...u16(opts.outs),
    ...u16(0), // tries_size
    ...u32(0), // debug_info_off
    ...u32(insnsUnits),
    ...opts.insns,
  ];
}

/** Builds an executable Dalvik DEX (035) with SHA-1 signature and Adler32 checksum. */
export async function buildDexAsync(options: DexOptions): Promise<Uint8Array> {
  const mainClass = options.classDescriptor;
  const pkgPrefix = mainClass.slice(0, mainClass.lastIndexOf('/') + 1); // e.g. Lcom/forge/droid/
  const bridgeClass = `${pkgPrefix}Bridge;`;
  const superClass = options.superDescriptor ?? 'Landroid/app/Activity;';
  const mainSource = options.sourceFile ?? 'MainActivity.kt';
  const bridgeSource = 'Bridge.kt';
  const assetUrl = options.assetEntryUrl ?? 'file:///android_asset/webapp/index.html';
  const deviceInfoJson = '{"sdk":34,"runtime":"Android WebView"}';
  const logTag = 'APKForge';
  const jsBridgeName = 'Android';
  const vibratorServiceName = 'vibrator';

  // Types referenced across MainActivity + Bridge
  const T_VOID = 'V';
  const T_BOOL = 'Z';
  const T_INT = 'I';
  const T_LONG = 'J';
  const T_OBJ = 'Ljava/lang/Object;';
  const T_STR = 'Ljava/lang/String;';
  const T_CHARSEQ = 'Ljava/lang/CharSequence;';
  const T_CTX = 'Landroid/content/Context;';
  const T_BUNDLE = 'Landroid/os/Bundle;';
  const T_VIBRATOR = 'Landroid/os/Vibrator;';
  const T_VIEW = 'Landroid/view/View;';
  const T_ACT = superClass;
  const T_WEBVIEW = 'Landroid/webkit/WebView;';
  const T_WEBSETTINGS = 'Landroid/webkit/WebSettings;';
  const T_WEBCLIENT = 'Landroid/webkit/WebViewClient;';
  const T_JSIFACE = 'Landroid/webkit/JavascriptInterface;';
  const T_LOG = 'Landroid/util/Log;';
  const T_TOAST = 'Landroid/widget/Toast;';

  const protoSpecs: ProtoSpec[] = [
    { key: '()V', shorty: 'V', returnType: T_VOID, params: [] },
    { key: '()Ljava/lang/String;', shorty: 'L', returnType: T_STR, params: [] },
    { key: '()Landroid/webkit/WebSettings;', shorty: 'L', returnType: T_WEBSETTINGS, params: [] },
    { key: '(Z)V', shorty: 'VZ', returnType: T_VOID, params: [T_BOOL] },
    { key: '(I)V', shorty: 'VI', returnType: T_VOID, params: [T_INT] },
    { key: '(J)V', shorty: 'VJ', returnType: T_VOID, params: [T_LONG] },
    { key: '(Landroid/content/Context;)V', shorty: 'VL', returnType: T_VOID, params: [T_CTX] },
    { key: '(Landroid/os/Bundle;)V', shorty: 'VL', returnType: T_VOID, params: [T_BUNDLE] },
    { key: '(Landroid/view/View;)V', shorty: 'VL', returnType: T_VOID, params: [T_VIEW] },
    { key: '(Landroid/webkit/WebViewClient;)V', shorty: 'VL', returnType: T_VOID, params: [T_WEBCLIENT] },
    { key: '(Ljava/lang/String;)V', shorty: 'VL', returnType: T_VOID, params: [T_STR] },
    { key: '(Ljava/lang/String;)Ljava/lang/Object;', shorty: 'LL', returnType: T_OBJ, params: [T_STR] },
    { key: '(Ljava/lang/Object;Ljava/lang/String;)V', shorty: 'VLL', returnType: T_VOID, params: [T_OBJ, T_STR] },
    { key: '(Ljava/lang/String;Ljava/lang/String;)I', shorty: 'ILL', returnType: T_INT, params: [T_STR, T_STR] },
    {
      key: '(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;',
      shorty: 'LLLI',
      returnType: T_TOAST,
      params: [T_CTX, T_CHARSEQ, T_INT],
    },
  ];

  const fieldSpecs: FieldSpec[] = [{ classDesc: bridgeClass, typeDesc: T_CTX, name: 'context' }];

  const methodSpecs: MethodSpec[] = [
    { key: 'Object.<init>', classDesc: T_OBJ, protoKey: '()V', name: '<init>' },
    { key: 'Activity.<init>', classDesc: T_ACT, protoKey: '()V', name: '<init>' },
    { key: 'Activity.onCreate', classDesc: T_ACT, protoKey: '(Landroid/os/Bundle;)V', name: 'onCreate' },
    { key: 'Activity.setContentView', classDesc: T_ACT, protoKey: '(Landroid/view/View;)V', name: 'setContentView' },
    { key: 'WebView.<init>', classDesc: T_WEBVIEW, protoKey: '(Landroid/content/Context;)V', name: '<init>' },
    {
      key: 'WebView.getSettings',
      classDesc: T_WEBVIEW,
      protoKey: '()Landroid/webkit/WebSettings;',
      name: 'getSettings',
    },
    {
      key: 'WebView.setWebViewClient',
      classDesc: T_WEBVIEW,
      protoKey: '(Landroid/webkit/WebViewClient;)V',
      name: 'setWebViewClient',
    },
    {
      key: 'WebView.addJavascriptInterface',
      classDesc: T_WEBVIEW,
      protoKey: '(Ljava/lang/Object;Ljava/lang/String;)V',
      name: 'addJavascriptInterface',
    },
    { key: 'WebView.loadUrl', classDesc: T_WEBVIEW, protoKey: '(Ljava/lang/String;)V', name: 'loadUrl' },
    {
      key: 'WebSettings.setJavaScriptEnabled',
      classDesc: T_WEBSETTINGS,
      protoKey: '(Z)V',
      name: 'setJavaScriptEnabled',
    },
    {
      key: 'WebSettings.setDomStorageEnabled',
      classDesc: T_WEBSETTINGS,
      protoKey: '(Z)V',
      name: 'setDomStorageEnabled',
    },
    {
      key: 'WebSettings.setAllowFileAccess',
      classDesc: T_WEBSETTINGS,
      protoKey: '(Z)V',
      name: 'setAllowFileAccess',
    },
    {
      key: 'WebSettings.setMediaPlaybackRequiresUserGesture',
      classDesc: T_WEBSETTINGS,
      protoKey: '(Z)V',
      name: 'setMediaPlaybackRequiresUserGesture',
    },
    {
      key: 'Context.getSystemService',
      classDesc: T_CTX,
      protoKey: '(Ljava/lang/String;)Ljava/lang/Object;',
      name: 'getSystemService',
    },
    { key: 'Vibrator.vibrate', classDesc: T_VIBRATOR, protoKey: '(J)V', name: 'vibrate' },
    { key: 'WebViewClient.<init>', classDesc: T_WEBCLIENT, protoKey: '()V', name: '<init>' },
    { key: 'Log.i', classDesc: T_LOG, protoKey: '(Ljava/lang/String;Ljava/lang/String;)I', name: 'i' },
    {
      key: 'Toast.makeText',
      classDesc: T_TOAST,
      protoKey: '(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;',
      name: 'makeText',
    },
    { key: 'Toast.show', classDesc: T_TOAST, protoKey: '()V', name: 'show' },
    // Bridge methods
    { key: 'Bridge.<init>', classDesc: bridgeClass, protoKey: '(Landroid/content/Context;)V', name: '<init>' },
    { key: 'Bridge.deviceInfo', classDesc: bridgeClass, protoKey: '()Ljava/lang/String;', name: 'deviceInfo' },
    { key: 'Bridge.log', classDesc: bridgeClass, protoKey: '(Ljava/lang/String;)V', name: 'log' },
    { key: 'Bridge.showToast', classDesc: bridgeClass, protoKey: '(Ljava/lang/String;)V', name: 'showToast' },
    { key: 'Bridge.vibrate', classDesc: bridgeClass, protoKey: '(I)V', name: 'vibrate' },
    // MainActivity methods
    { key: 'Main.<init>', classDesc: mainClass, protoKey: '()V', name: '<init>' },
    { key: 'Main.onCreate', classDesc: mainClass, protoKey: '(Landroid/os/Bundle;)V', name: 'onCreate' },
  ];

  const allTypes = Array.from(
    new Set([
      mainClass,
      bridgeClass,
      T_VOID,
      T_BOOL,
      T_INT,
      T_LONG,
      T_OBJ,
      T_STR,
      T_CHARSEQ,
      T_CTX,
      T_BUNDLE,
      T_VIBRATOR,
      T_VIEW,
      T_ACT,
      T_WEBVIEW,
      T_WEBSETTINGS,
      T_WEBCLIENT,
      T_JSIFACE,
      T_LOG,
      T_TOAST,
    ]),
  );

  const rawStrings = new Set<string>([
    ...allTypes,
    ...protoSpecs.map((p) => p.shorty),
    ...fieldSpecs.map((f) => f.name),
    ...methodSpecs.map((m) => m.name),
    mainSource,
    bridgeSource,
    assetUrl,
    deviceInfoJson,
    logTag,
    jsBridgeName,
    vibratorServiceName,
  ]);

  // 1. Sorted string table
  const strings = Array.from(rawStrings).sort(compareModifiedUtf8);
  const strIdx = (s: string): number => {
    const i = strings.indexOf(s);
    if (i < 0) throw new Error(`Missing DEX string: ${s}`);
    return i;
  };

  // 2. Sorted type_ids (by descriptor string index)
  const types = [...allTypes].sort((a, b) => strIdx(a) - strIdx(b));
  const typeIdx = (t: string): number => {
    const i = types.indexOf(t);
    if (i < 0) throw new Error(`Missing DEX type: ${t}`);
    return i;
  };

  // 3. Sorted proto_ids (by return_type_idx, then lexicographical parameter type_idxs)
  const sortedProtos = [...protoSpecs].sort((a, b) => {
    const rDiff = typeIdx(a.returnType) - typeIdx(b.returnType);
    if (rDiff !== 0) return rDiff;
    const minLen = Math.min(a.params.length, b.params.length);
    for (let i = 0; i < minLen; i++) {
      const pDiff = typeIdx(a.params[i]) - typeIdx(b.params[i]);
      if (pDiff !== 0) return pDiff;
    }
    return a.params.length - b.params.length;
  });
  const protoIdx = (key: string): number => {
    const i = sortedProtos.findIndex((p) => p.key === key);
    if (i < 0) throw new Error(`Missing DEX proto: ${key}`);
    return i;
  };

  // 4. Sorted field_ids (by class_idx, name_idx, type_idx)
  const sortedFields = [...fieldSpecs].sort((a, b) => {
    return (
      typeIdx(a.classDesc) - typeIdx(b.classDesc) ||
      strIdx(a.name) - strIdx(b.name) ||
      typeIdx(a.typeDesc) - typeIdx(b.typeDesc)
    );
  });

  // 5. Sorted method_ids (by class_idx, name_idx, proto_idx)
  const sortedMethods = [...methodSpecs].sort((a, b) => {
    return (
      typeIdx(a.classDesc) - typeIdx(b.classDesc) ||
      strIdx(a.name) - strIdx(b.name) ||
      protoIdx(a.protoKey) - protoIdx(b.protoKey)
    );
  });
  const methIdx = (key: string): number => {
    const i = sortedMethods.findIndex((m) => m.key === key);
    if (i < 0) throw new Error(`Missing DEX method: ${key}`);
    return i;
  };

  // Index sections layout (immediately following 0x70-byte header)
  const headerSize = 0x70;
  const stringIdsOff = headerSize;
  const typeIdsOff = stringIdsOff + strings.length * 4;
  const protoIdsOff = typeIdsOff + types.length * 4;
  const fieldIdsOff = protoIdsOff + sortedProtos.length * 12;
  const methodIdsOff = fieldIdsOff + sortedFields.length * 8;
  const classDefsOff = methodIdsOff + sortedMethods.length * 8;
  const classDefsSize = 2; // Bridge + MainActivity
  const dataOff = align4(classDefsOff + classDefsSize * 32);

  // ---- Data section items in STRICTLY ASCENDING OFFSET ORDER ---------------
  let cursor = dataOff;

  // (a) TYPE_TYPE_LIST (0x1001) — deduplicated parameter type lists for protos with params
  const paramListMap = new Map<string, number>();
  const typeListBlobs: { off: number; bytes: number[] }[] = [];
  for (const p of sortedProtos) {
    if (p.params.length === 0) continue;
    const sig = p.params.join('|');
    if (paramListMap.has(sig)) continue;
    cursor = align4(cursor);
    const bytes = [...u32(p.params.length), ...p.params.flatMap((t) => u16(typeIdx(t)))];
    paramListMap.set(sig, cursor);
    typeListBlobs.push({ off: cursor, bytes });
    cursor += bytes.length;
  }

  // (b) TYPE_ANNOTATION_ITEM (0x2004) — VISIBILITY_RUNTIME @Landroid/webkit/JavascriptInterface;
  const annotationItemOff = cursor;
  const annotationItemBytes = [0x01, ...uleb128(typeIdx(T_JSIFACE)), 0x00];
  cursor += annotationItemBytes.length;

  // (c) TYPE_ANNOTATION_SET_ITEM (0x1003) — 4-byte aligned
  cursor = align4(cursor);
  const annotationSetOff = cursor;
  const annotationSetBytes = [...u32(1), ...u32(annotationItemOff)];
  cursor += annotationSetBytes.length;

  // (d) TYPE_ANNOTATIONS_DIRECTORY_ITEM (0x2006) — 4-byte aligned, annotating Bridge's 4 @JavascriptInterface methods
  cursor = align4(cursor);
  const annotationsDirOff = cursor;
  const bridgeJsMethodIdxs = [
    methIdx('Bridge.deviceInfo'),
    methIdx('Bridge.log'),
    methIdx('Bridge.showToast'),
    methIdx('Bridge.vibrate'),
  ].sort((a, b) => a - b);
  const annotationsDirBytes = [
    ...u32(0), // class_annotations_off
    ...u32(0), // fields_size
    ...u32(bridgeJsMethodIdxs.length), // annotated_methods_size
    ...u32(0), // annotated_parameters_size
    ...bridgeJsMethodIdxs.flatMap((mId) => [...u32(mId), ...u32(annotationSetOff)]),
  ];
  cursor += annotationsDirBytes.length;

  // (e) TYPE_CODE_ITEM (0x2001) — 4-byte aligned, 6 methods across Bridge + MainActivity
  const fBridgeCtx = 0; // only 1 field in sortedFields

  const bridgeInitCode = buildCodeItem({
    registers: 2,
    ins: 2,
    outs: 1,
    insns: [
      ...u16(0x1070),
      ...u16(methIdx('Object.<init>')),
      ...u16(0x0000), // invoke-direct {v0}, Object.<init>()V
      ...u16(0x015b),
      ...u16(fBridgeCtx), // iput-object v1, v0, Bridge.context
      ...u16(0x000e), // return-void
    ],
  });

  const bridgeDeviceInfoCode = buildCodeItem({
    registers: 2,
    ins: 1,
    outs: 0,
    insns: [
      ...u16(0x001a),
      ...u16(strIdx(deviceInfoJson)), // const-string v0, "..."
      ...u16(0x0011), // return-object v0
    ],
  });

  const bridgeLogCode = buildCodeItem({
    registers: 3,
    ins: 2,
    outs: 2,
    insns: [
      ...u16(0x001a),
      ...u16(strIdx(logTag)), // const-string v0, "APKForge"
      ...u16(0x2071),
      ...u16(methIdx('Log.i')),
      ...u16(0x0020), // invoke-static {v0, v2}, Log.i
      ...u16(0x000e), // return-void
    ],
  });

  const bridgeToastCode = buildCodeItem({
    registers: 4,
    ins: 2,
    outs: 3,
    insns: [
      ...u16(0x2054),
      ...u16(fBridgeCtx), // iget-object v0, v2, Bridge.context
      ...u16(0x0112), // const/4 v1, 0
      ...u16(0x3071),
      ...u16(methIdx('Toast.makeText')),
      ...u16(0x0130), // invoke-static {v0, v3, v1}, Toast.makeText
      ...u16(0x000c), // move-result-object v0
      ...u16(0x106e),
      ...u16(methIdx('Toast.show')),
      ...u16(0x0000), // invoke-virtual {v0}, Toast.show
      ...u16(0x000e), // return-void
    ],
  });

  const bridgeVibrateCode = buildCodeItem({
    registers: 5, // v0..v2 locals, v3=this, v4=ms(int)
    ins: 2,
    outs: 3,
    insns: [
      ...u16(0x3054),
      ...u16(fBridgeCtx), // iget-object v0, v3, Bridge.context
      ...u16(0x011a),
      ...u16(strIdx(vibratorServiceName)), // const-string v1, "vibrator"
      ...u16(0x206e),
      ...u16(methIdx('Context.getSystemService')),
      ...u16(0x0010), // invoke-virtual {v0, v1}, Context.getSystemService
      ...u16(0x000c), // move-result-object v0
      ...u16(0x0038),
      ...u16(0x0008), // if-eqz v0, +8 (to return-void)
      ...u16(0x001f),
      ...u16(typeIdx(T_VIBRATOR)), // check-cast v0, Vibrator
      ...u16(0x4181), // int-to-long v1, v4 (v1..v2 = (long) v4)
      ...u16(0x306e),
      ...u16(methIdx('Vibrator.vibrate')),
      ...u16(0x0210), // invoke-virtual {v0, v1, v2}, Vibrator.vibrate(J)V
      ...u16(0x000e), // return-void
    ],
  });

  const mainInitCode = buildCodeItem({
    registers: 1,
    ins: 1,
    outs: 1,
    insns: [
      ...u16(0x1070),
      ...u16(methIdx('Activity.<init>')),
      ...u16(0x0000), // invoke-direct {v0}, Activity.<init>()V
      ...u16(0x000e), // return-void
    ],
  });

  const mainOnCreateCode = buildCodeItem({
    registers: 6, // v0..v3 locals, v4=this, v5=savedInstanceState
    ins: 2,
    outs: 3,
    insns: [
      ...u16(0x206f),
      ...u16(methIdx('Activity.onCreate')),
      ...u16(0x0054), // invoke-super {v4, v5}, Activity.onCreate
      ...u16(0x0022),
      ...u16(typeIdx(T_WEBVIEW)), // new-instance v0, WebView
      ...u16(0x2070),
      ...u16(methIdx('WebView.<init>')),
      ...u16(0x0040), // invoke-direct {v0, v4}, WebView.<init>(Context)
      ...u16(0x106e),
      ...u16(methIdx('WebView.getSettings')),
      ...u16(0x0000), // invoke-virtual {v0}, WebView.getSettings
      ...u16(0x010c), // move-result-object v1
      ...u16(0x1212), // const/4 v2, 1
      ...u16(0x206e),
      ...u16(methIdx('WebSettings.setJavaScriptEnabled')),
      ...u16(0x0021), // setJavaScriptEnabled(true)
      ...u16(0x206e),
      ...u16(methIdx('WebSettings.setDomStorageEnabled')),
      ...u16(0x0021), // setDomStorageEnabled(true)
      ...u16(0x206e),
      ...u16(methIdx('WebSettings.setAllowFileAccess')),
      ...u16(0x0021), // setAllowFileAccess(true)
      ...u16(0x0212), // const/4 v2, 0
      ...u16(0x206e),
      ...u16(methIdx('WebSettings.setMediaPlaybackRequiresUserGesture')),
      ...u16(0x0021), // setMediaPlaybackRequiresUserGesture(false)
      ...u16(0x0222),
      ...u16(typeIdx(T_WEBCLIENT)), // new-instance v2, WebViewClient
      ...u16(0x1070),
      ...u16(methIdx('WebViewClient.<init>')),
      ...u16(0x0002), // invoke-direct {v2}, WebViewClient.<init>()
      ...u16(0x206e),
      ...u16(methIdx('WebView.setWebViewClient')),
      ...u16(0x0020), // setWebViewClient
      ...u16(0x0222),
      ...u16(typeIdx(bridgeClass)), // new-instance v2, Bridge
      ...u16(0x2070),
      ...u16(methIdx('Bridge.<init>')),
      ...u16(0x0042), // invoke-direct {v2, v4}, Bridge.<init>(Context)
      ...u16(0x031a),
      ...u16(strIdx(jsBridgeName)), // const-string v3, "Android"
      ...u16(0x306e),
      ...u16(methIdx('WebView.addJavascriptInterface')),
      ...u16(0x0320), // addJavascriptInterface(v2, "Android")
      ...u16(0x021a),
      ...u16(strIdx(assetUrl)), // const-string v2, "file:///android_asset/webapp/index.html"
      ...u16(0x206e),
      ...u16(methIdx('WebView.loadUrl')),
      ...u16(0x0020), // loadUrl
      ...u16(0x206e),
      ...u16(methIdx('Activity.setContentView')),
      ...u16(0x0004), // setContentView(v0) on v4
      ...u16(0x000e), // return-void
    ],
  });

  const codeSpecs = [
    { key: 'Bridge.<init>', bytes: bridgeInitCode },
    { key: 'Bridge.deviceInfo', bytes: bridgeDeviceInfoCode },
    { key: 'Bridge.log', bytes: bridgeLogCode },
    { key: 'Bridge.showToast', bytes: bridgeToastCode },
    { key: 'Bridge.vibrate', bytes: bridgeVibrateCode },
    { key: 'Main.<init>', bytes: mainInitCode },
    { key: 'Main.onCreate', bytes: mainOnCreateCode },
  ];
  const codeOffsets = new Map<string, number>();
  const codeBlobs: { off: number; bytes: number[] }[] = [];
  for (const cs of codeSpecs) {
    cursor = align4(cursor);
    codeOffsets.set(cs.key, cursor);
    codeBlobs.push({ off: cursor, bytes: cs.bytes });
    cursor += cs.bytes.length;
  }

  // (f) TYPE_STRING_DATA_ITEM (0x2002) — 1-byte aligned
  const stringDataOffsets: number[] = [];
  const stringDataBlobs: { off: number; bytes: number[] }[] = [];
  for (const s of strings) {
    const encoded = Array.from(new TextEncoder().encode(s));
    const bytes = [...uleb128(utf16Size(s)), ...encoded, 0x00];
    stringDataOffsets.push(cursor);
    stringDataBlobs.push({ off: cursor, bytes });
    cursor += bytes.length;
  }

  // (g) TYPE_CLASS_DATA_ITEM (0x2000) — 1-byte aligned
  const encodeMethodsList = (items: { methodIdx: number; accessFlags: number; codeOff: number }[]): number[] => {
    const sorted = [...items].sort((a, b) => a.methodIdx - b.methodIdx);
    const out: number[] = [];
    let prev = 0;
    for (const item of sorted) {
      out.push(...uleb128(item.methodIdx - prev), ...uleb128(item.accessFlags), ...uleb128(item.codeOff));
      prev = item.methodIdx;
    }
    return out;
  };

  // Sort class_defs by class type_idx for clean determinism
  const classOrder = [
    {
      classDesc: bridgeClass,
      superDesc: T_OBJ,
      sourceFile: bridgeSource,
      annotationsOff: annotationsDirOff,
      instanceFields: [{ fieldIdx: fBridgeCtx, accessFlags: 0x0012 }], // ACC_PRIVATE | ACC_FINAL
      directMethods: [
        { methodIdx: methIdx('Bridge.<init>'), accessFlags: 0x10001, codeOff: codeOffsets.get('Bridge.<init>')! },
      ],
      virtualMethods: [
        { methodIdx: methIdx('Bridge.deviceInfo'), accessFlags: 0x0001, codeOff: codeOffsets.get('Bridge.deviceInfo')! },
        { methodIdx: methIdx('Bridge.log'), accessFlags: 0x0001, codeOff: codeOffsets.get('Bridge.log')! },
        { methodIdx: methIdx('Bridge.showToast'), accessFlags: 0x0001, codeOff: codeOffsets.get('Bridge.showToast')! },
        { methodIdx: methIdx('Bridge.vibrate'), accessFlags: 0x0001, codeOff: codeOffsets.get('Bridge.vibrate')! },
      ],
    },
    {
      classDesc: mainClass,
      superDesc: T_ACT,
      sourceFile: mainSource,
      annotationsOff: 0,
      instanceFields: [] as { fieldIdx: number; accessFlags: number }[],
      directMethods: [
        { methodIdx: methIdx('Main.<init>'), accessFlags: 0x10001, codeOff: codeOffsets.get('Main.<init>')! },
      ],
      virtualMethods: [
        { methodIdx: methIdx('Main.onCreate'), accessFlags: 0x0004, codeOff: codeOffsets.get('Main.onCreate')! },
      ],
    },
  ].sort((a, b) => typeIdx(a.classDesc) - typeIdx(b.classDesc));

  const classDataBlobs: { off: number; bytes: number[] }[] = [];
  for (const cls of classOrder) {
    const fieldBytes: number[] = [];
    let prevF = 0;
    for (const f of cls.instanceFields) {
      fieldBytes.push(...uleb128(f.fieldIdx - prevF), ...uleb128(f.accessFlags));
      prevF = f.fieldIdx;
    }
    const bytes = [
      ...uleb128(0), // static_fields_size
      ...uleb128(cls.instanceFields.length), // instance_fields_size
      ...uleb128(cls.directMethods.length), // direct_methods_size
      ...uleb128(cls.virtualMethods.length), // virtual_methods_size
      ...fieldBytes,
      ...encodeMethodsList(cls.directMethods),
      ...encodeMethodsList(cls.virtualMethods),
    ];
    classDataBlobs.push({ off: cursor, bytes });
    cursor += bytes.length;
  }

  // (h) TYPE_MAP_LIST (0x1000) — 4-byte aligned AT THE VERY END so every offset is strictly ascending!
  cursor = align4(cursor);
  const mapOff = cursor;
  const mapEntries: [number, number, number][] = [
    [TYPE_HEADER_ITEM, 1, 0],
    [TYPE_STRING_ID_ITEM, strings.length, stringIdsOff],
    [TYPE_TYPE_ID_ITEM, types.length, typeIdsOff],
    [TYPE_PROTO_ID_ITEM, sortedProtos.length, protoIdsOff],
    [TYPE_FIELD_ID_ITEM, sortedFields.length, fieldIdsOff],
    [TYPE_METHOD_ID_ITEM, sortedMethods.length, methodIdsOff],
    [TYPE_CLASS_DEF_ITEM, classOrder.length, classDefsOff],
    [TYPE_TYPE_LIST, typeListBlobs.length, typeListBlobs[0].off],
    [TYPE_ANNOTATION_ITEM, 1, annotationItemOff],
    [TYPE_ANNOTATION_SET_ITEM, 1, annotationSetOff],
    [TYPE_ANNOTATIONS_DIRECTORY_ITEM, 1, annotationsDirOff],
    [TYPE_CODE_ITEM, codeBlobs.length, codeBlobs[0].off],
    [TYPE_STRING_DATA_ITEM, strings.length, stringDataOffsets[0]],
    [TYPE_CLASS_DATA_ITEM, classDataBlobs.length, classDataBlobs[0].off],
    [TYPE_MAP_LIST, 1, mapOff],
  ];
  const mapListBytes = [
    ...u32(mapEntries.length),
    ...mapEntries.flatMap(([type, size, off]) => [...u16(type), ...u16(0), ...u32(size), ...u32(off)]),
  ];

  const fileSize = align4(mapOff + mapListBytes.length);

  // ---- Assemble full binary buffer ----------------------------------------
  const bytes = new Uint8Array(fileSize);
  const write = (off: number, arr: number[]) => {
    for (let i = 0; i < arr.length; i++) bytes[off + i] = arr[i];
  };

  write(0x00, Array.from(new TextEncoder().encode('dex\n035\u0000')));
  write(stringIdsOff, stringDataOffsets.flatMap((o) => u32(o)));
  write(typeIdsOff, types.flatMap((t) => u32(strIdx(t))));
  write(
    protoIdsOff,
    sortedProtos.flatMap((p) => [
      ...u32(strIdx(p.shorty)),
      ...u32(typeIdx(p.returnType)),
      ...u32(p.params.length ? paramListMap.get(p.params.join('|'))! : 0),
    ]),
  );
  write(
    fieldIdsOff,
    sortedFields.flatMap((f) => [...u16(typeIdx(f.classDesc)), ...u16(typeIdx(f.typeDesc)), ...u32(strIdx(f.name))]),
  );
  write(
    methodIdsOff,
    sortedMethods.flatMap((m) => [...u16(typeIdx(m.classDesc)), ...u16(protoIdx(m.protoKey)), ...u32(strIdx(m.name))]),
  );
  write(
    classDefsOff,
    classOrder.flatMap((cls, idx) => [
      ...u32(typeIdx(cls.classDesc)),
      ...u32(0x0021), // ACC_PUBLIC | ACC_SUPER
      ...u32(typeIdx(cls.superDesc)),
      ...u32(0), // interfaces_off
      ...u32(strIdx(cls.sourceFile)),
      ...u32(cls.annotationsOff),
      ...u32(classDataBlobs[idx].off),
      ...u32(0), // static_values_off
    ]),
  );

  for (const b of typeListBlobs) write(b.off, b.bytes);
  write(annotationItemOff, annotationItemBytes);
  write(annotationSetOff, annotationSetBytes);
  write(annotationsDirOff, annotationsDirBytes);
  for (const b of codeBlobs) write(b.off, b.bytes);
  for (const b of stringDataBlobs) write(b.off, b.bytes);
  for (const b of classDataBlobs) write(b.off, b.bytes);
  write(mapOff, mapListBytes);

  // Header metadata
  write(0x20, u32(fileSize));
  write(0x24, u32(headerSize));
  write(0x28, u32(0x12345678));
  write(0x2c, u32(0));
  write(0x30, u32(0));
  write(0x34, u32(mapOff));
  write(0x38, u32(strings.length));
  write(0x3c, u32(stringIdsOff));
  write(0x40, u32(types.length));
  write(0x44, u32(typeIdsOff));
  write(0x48, u32(sortedProtos.length));
  write(0x4c, u32(protoIdsOff));
  write(0x50, u32(sortedFields.length));
  write(0x54, u32(fieldIdsOff));
  write(0x58, u32(sortedMethods.length));
  write(0x5c, u32(methodIdsOff));
  write(0x60, u32(classOrder.length));
  write(0x64, u32(classDefsOff));
  write(0x68, u32(fileSize - dataOff));
  write(0x6c, u32(dataOff));

  // SHA-1 signature (bytes 32..end) + Adler32 checksum (bytes 12..end)
  const sha1Buf = new Uint8Array(bytes.slice(32)).buffer as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', sha1Buf));
  bytes.set(digest, 12);
  const adler = adler32(bytes.slice(12));
  write(8, u32(adler));

  return bytes;
}

export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
