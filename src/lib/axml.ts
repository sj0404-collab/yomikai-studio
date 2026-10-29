// Android Binary XML (AXML — RES_XML_TYPE 0x0003) compiler and reader.
// Compiles AndroidManifest.xml into binary AXML accepted by Android PackageManager
// and `aapt dump badging` / `aapt dump xmltree`, and decodes package metadata
// from external compiled APKs opened in the emulator.

import { buildUtf16StringPool, RES_ID_APP_NAME, RES_ID_IC_LAUNCHER } from './arsc';

const ANDROID_NS_URI = 'http://schemas.android.com/apk/res/android';
const ANDROID_NS_PREFIX = 'android';
const NO_INDEX = 0xffffffff;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

// Sorted strictly by ascending android.R.attr resource ID!
const ANDROID_ATTR_TABLE: readonly { name: string; resId: number }[] = [
  { name: 'theme', resId: 0x01010000 },
  { name: 'label', resId: 0x01010001 },
  { name: 'icon', resId: 0x01010002 },
  { name: 'name', resId: 0x01010003 },
  { name: 'debuggable', resId: 0x0101000f },
  { name: 'exported', resId: 0x01010010 },
  { name: 'configChanges', resId: 0x0101001f },
  { name: 'minSdkVersion', resId: 0x0101020c },
  { name: 'versionCode', resId: 0x0101021b },
  { name: 'versionName', resId: 0x0101021c },
  { name: 'targetSdkVersion', resId: 0x01010270 },
  { name: 'allowBackup', resId: 0x01010280 },
  { name: 'supportsRtl', resId: 0x010103af },
  { name: 'usesCleartextTraffic', resId: 0x010104ec },
  { name: 'compileSdkVersion', resId: 0x01010572 },
];

// Built-in Android Material dark no-action-bar system theme (android.R.style.Theme_Material_NoActionBar)
const ANDROID_STYLE_MATERIAL_NO_ACTION_BAR = 0x0103022e;

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

interface AxmlAttrSpec {
  androidAttr?: string; // key in ANDROID_ATTR_TABLE
  rawName?: string; // non-namespaced attribute (e.g. "package")
  valueType: number;
  stringValue?: string;
  intValue?: number;
}

interface AxmlNodeSpec {
  tag: string;
  line: number;
  attrs: AxmlAttrSpec[];
  children?: AxmlNodeSpec[];
}

export interface ManifestCompileInput {
  manifestXml: string;
  packageName: string; // effective applicationId (e.g. com.forge.droid or com.forge.droid.debug)
  namespace: string; // code namespace for resolving relative ".MainActivity"
  versionCode: number;
  versionName: string;
  minSdk: number;
  targetSdk: number;
  compileSdk: number;
  debuggable: boolean;
}

function parseManifestDetails(xml: string, codeNamespace: string): {
  permissions: string[];
  activityName: string;
  exported: boolean;
  allowBackup: boolean;
  supportsRtl: boolean;
} {
  const permissions: string[] = [];
  const permRe = /<uses-permission[^>]*android:name\s*=\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = permRe.exec(xml))) {
    if (!permissions.includes(m[1])) permissions.push(m[1]);
  }
  if (permissions.length === 0) {
    permissions.push('android.permission.INTERNET');
  }

  const actMatch = xml.match(/<activity[^>]*android:name\s*=\s*["']([^"']+)["']/);
  let rawAct = actMatch?.[1] ?? '.MainActivity';
  if (rawAct.startsWith('.')) {
    rawAct = `${codeNamespace}${rawAct}`;
  } else if (!rawAct.includes('.')) {
    rawAct = `${codeNamespace}.${rawAct}`;
  }

  const exportedMatch = xml.match(/<activity[\s\S]*?android:exported\s*=\s*["'](true|false)["']/);
  const exported = exportedMatch ? exportedMatch[1] === 'true' : true;

  const backupMatch = xml.match(/android:allowBackup\s*=\s*["'](true|false)["']/);
  const allowBackup = backupMatch ? backupMatch[1] === 'true' : true;

  const rtlMatch = xml.match(/android:supportsRtl\s*=\s*["'](true|false)["']/);
  const supportsRtl = rtlMatch ? rtlMatch[1] === 'true' : true;

  return { permissions, activityName: rawAct, exported, allowBackup, supportsRtl };
}

/** Compile AndroidManifest.xml + Gradle config into valid Android Binary XML (AXML). */
export function compileManifestAxml(input: ManifestCompileInput): Uint8Array {
  const details = parseManifestDetails(input.manifestXml, input.namespace);

  // Build AST of manifest
  const root: AxmlNodeSpec = {
    tag: 'manifest',
    line: 2,
    attrs: [
      { androidAttr: 'versionCode', valueType: TYPE_INT_DEC, intValue: input.versionCode },
      { androidAttr: 'versionName', valueType: TYPE_STRING, stringValue: input.versionName },
      { androidAttr: 'compileSdkVersion', valueType: TYPE_INT_DEC, intValue: input.compileSdk },
      { rawName: 'package', valueType: TYPE_STRING, stringValue: input.packageName },
    ],
    children: [
      {
        tag: 'uses-sdk',
        line: 5,
        attrs: [
          { androidAttr: 'minSdkVersion', valueType: TYPE_INT_DEC, intValue: input.minSdk },
          { androidAttr: 'targetSdkVersion', valueType: TYPE_INT_DEC, intValue: input.targetSdk },
        ],
      },
      ...details.permissions.map((perm, idx) => ({
        tag: 'uses-permission',
        line: 7 + idx,
        attrs: [{ androidAttr: 'name', valueType: TYPE_STRING, stringValue: perm }],
      })),
      {
        tag: 'application',
        line: 12,
        attrs: [
          { androidAttr: 'theme', valueType: TYPE_REFERENCE, intValue: ANDROID_STYLE_MATERIAL_NO_ACTION_BAR },
          { androidAttr: 'label', valueType: TYPE_REFERENCE, intValue: RES_ID_APP_NAME },
          { androidAttr: 'icon', valueType: TYPE_REFERENCE, intValue: RES_ID_IC_LAUNCHER },
          { androidAttr: 'debuggable', valueType: TYPE_INT_BOOLEAN, intValue: input.debuggable ? 0xffffffff : 0 },
          { androidAttr: 'allowBackup', valueType: TYPE_INT_BOOLEAN, intValue: details.allowBackup ? 0xffffffff : 0 },
          { androidAttr: 'supportsRtl', valueType: TYPE_INT_BOOLEAN, intValue: details.supportsRtl ? 0xffffffff : 0 },
          { androidAttr: 'usesCleartextTraffic', valueType: TYPE_INT_BOOLEAN, intValue: 0xffffffff },
        ],
        children: [
          {
            tag: 'activity',
            line: 19,
            attrs: [
              { androidAttr: 'label', valueType: TYPE_REFERENCE, intValue: RES_ID_APP_NAME },
              { androidAttr: 'name', valueType: TYPE_STRING, stringValue: details.activityName },
              { androidAttr: 'exported', valueType: TYPE_INT_BOOLEAN, intValue: details.exported ? 0xffffffff : 0 },
              // orientation (0x80) | keyboardHidden (0x20) | screenSize (0x400) = 0x04a0
              { androidAttr: 'configChanges', valueType: TYPE_INT_HEX, intValue: 0x000004a0 },
            ],
            children: [
              {
                tag: 'intent-filter',
                line: 24,
                attrs: [],
                children: [
                  {
                    tag: 'action',
                    line: 25,
                    attrs: [{ androidAttr: 'name', valueType: TYPE_STRING, stringValue: 'android.intent.action.MAIN' }],
                  },
                  {
                    tag: 'category',
                    line: 26,
                    attrs: [
                      { androidAttr: 'name', valueType: TYPE_STRING, stringValue: 'android.intent.category.LAUNCHER' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  // String pool MUST begin with ANDROID_ATTR_TABLE names at indices 0..N-1
  const strings: string[] = ANDROID_ATTR_TABLE.map((a) => a.name);
  const ensureString = (s: string): number => {
    const existing = strings.indexOf(s);
    if (existing >= 0) return existing;
    strings.push(s);
    return strings.length - 1;
  };

  const nsPrefixIdx = ensureString(ANDROID_NS_PREFIX);
  const nsUriIdx = ensureString(ANDROID_NS_URI);

  const collectStrings = (node: AxmlNodeSpec) => {
    ensureString(node.tag);
    for (const a of node.attrs) {
      if (a.rawName) ensureString(a.rawName);
      if (a.stringValue !== undefined) ensureString(a.stringValue);
    }
    node.children?.forEach(collectStrings);
  };
  collectStrings(root);

  const stringPoolChunk = Array.from(buildUtf16StringPool(strings));

  // RES_XML_RESOURCE_MAP_TYPE (0x0180) mapping indices 0..ANDROID_ATTR_TABLE.length-1
  const resMapHeaderSize = 8;
  const resMapSize = resMapHeaderSize + ANDROID_ATTR_TABLE.length * 4;
  const resMapChunk = [
    ...u16(0x0180),
    ...u16(resMapHeaderSize),
    ...u32(resMapSize),
    ...ANDROID_ATTR_TABLE.flatMap((a) => u32(a.resId)),
  ];

  const xmlNodes: number[] = [];

  // START_NAMESPACE
  xmlNodes.push(
    ...u16(0x0100),
    ...u16(16),
    ...u32(24),
    ...u32(1),
    ...u32(NO_INDEX),
    ...u32(nsPrefixIdx),
    ...u32(nsUriIdx),
  );

  const emitNode = (node: AxmlNodeSpec) => {
    const tagIdx = ensureString(node.tag);

    // Sort attributes: android:* sorted by ascending resId first, then raw (non-namespaced) attributes
    const sortedAttrs = [...node.attrs].sort((a, b) => {
      const idxA = a.androidAttr ? ANDROID_ATTR_TABLE.findIndex((x) => x.name === a.androidAttr) : 9999;
      const idxB = b.androidAttr ? ANDROID_ATTR_TABLE.findIndex((x) => x.name === b.androidAttr) : 9999;
      return idxA - idxB;
    });

    const attrBytes: number[] = [];
    for (const attr of sortedAttrs) {
      const attrNs = attr.androidAttr ? nsUriIdx : NO_INDEX;
      const attrName = attr.androidAttr
        ? ANDROID_ATTR_TABLE.findIndex((x) => x.name === attr.androidAttr)
        : ensureString(attr.rawName!);
      const isStr = attr.valueType === TYPE_STRING && attr.stringValue !== undefined;
      const strIdx = isStr ? ensureString(attr.stringValue!) : NO_INDEX;
      const dataVal = isStr ? strIdx : (attr.intValue ?? 0);

      attrBytes.push(
        ...u32(attrNs),
        ...u32(attrName),
        ...u32(strIdx), // rawValue
        ...u16(8), // Res_value.size
        0x00, // res0
        attr.valueType & 0xff,
        ...u32(dataVal >>> 0),
      );
    }

    const startSize = 36 + sortedAttrs.length * 20;
    xmlNodes.push(
      ...u16(0x0102), // RES_XML_START_ELEMENT_TYPE
      ...u16(16),
      ...u32(startSize),
      ...u32(node.line),
      ...u32(NO_INDEX),
      ...u32(NO_INDEX), // element ns
      ...u32(tagIdx),
      ...u16(20), // attributeStart
      ...u16(20), // attributeSize
      ...u16(sortedAttrs.length),
      ...u16(0), // idIndex
      ...u16(0), // classIndex
      ...u16(0), // styleIndex
      ...attrBytes,
    );

    node.children?.forEach(emitNode);

    xmlNodes.push(
      ...u16(0x0103), // RES_XML_END_ELEMENT_TYPE
      ...u16(16),
      ...u32(24),
      ...u32(node.line),
      ...u32(NO_INDEX),
      ...u32(NO_INDEX),
      ...u32(tagIdx),
    );
  };

  emitNode(root);

  // END_NAMESPACE
  xmlNodes.push(
    ...u16(0x0101),
    ...u16(16),
    ...u32(24),
    ...u32(30),
    ...u32(NO_INDEX),
    ...u32(nsPrefixIdx),
    ...u32(nsUriIdx),
  );

  const totalSize = 8 + stringPoolChunk.length + resMapChunk.length + xmlNodes.length;
  return new Uint8Array([
    ...u16(0x0003), // RES_XML_TYPE
    ...u16(8),
    ...u32(totalSize),
    ...stringPoolChunk,
    ...resMapChunk,
    ...xmlNodes,
  ]);
}

function readU16(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

function readU32(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

/** Decode package name & versionName from either binary AXML or plain-text AndroidManifest.xml. */
export function inspectManifestBytes(bytes: Uint8Array): {
  isBinaryAxml: boolean;
  packageName?: string;
  versionName?: string;
} {
  if (bytes.length >= 8 && readU16(bytes, 0) === 0x0003 && readU16(bytes, 2) === 8) {
    try {
      const spOff = 8;
      if (readU16(bytes, spOff) !== 0x0001) return { isBinaryAxml: true };
      const spChunkSize = readU32(bytes, spOff + 4);
      const strCount = readU32(bytes, spOff + 8);
      const flags = readU32(bytes, spOff + 16);
      const isUtf8 = (flags & (1 << 8)) !== 0;
      const stringsStart = spOff + readU32(bytes, spOff + 20);
      const pool: string[] = [];

      for (let i = 0; i < strCount; i++) {
        const sOff = stringsStart + readU32(bytes, spOff + 28 + i * 4);
        if (isUtf8) {
          let p = sOff;
          if (bytes[p] & 0x80) p += 2;
          else p += 1;
          let byteLen = bytes[p];
          if (byteLen & 0x80) {
            byteLen = ((byteLen & 0x7f) << 8) | bytes[p + 1];
            p += 2;
          } else {
            p += 1;
          }
          pool.push(new TextDecoder().decode(bytes.slice(p, p + byteLen)));
        } else {
          let charLen = readU16(bytes, sOff);
          let p = sOff + 2;
          if (charLen & 0x8000) {
            charLen = ((charLen & 0x7fff) << 16) | readU16(bytes, p);
            p += 2;
          }
          let out = '';
          for (let c = 0; c < charLen; c++) {
            out += String.fromCharCode(readU16(bytes, p + c * 2));
          }
          pool.push(out);
        }
      }

      let cursor = spOff + spChunkSize;
      while (cursor + 8 <= bytes.length) {
        const type = readU16(bytes, cursor);
        const chunkSize = readU32(bytes, cursor + 4);
        if (chunkSize < 8) break;
        if (type === 0x0102) {
          const nameIdx = readU32(bytes, cursor + 20);
          const attrStart = readU16(bytes, cursor + 24);
          const attrSize = readU16(bytes, cursor + 26);
          const attrCount = readU16(bytes, cursor + 28);
          if (pool[nameIdx] === 'manifest') {
            let packageName: string | undefined;
            let versionName: string | undefined;
            for (let a = 0; a < attrCount; a++) {
              const aOff = cursor + 16 + attrStart + a * attrSize;
              const aName = pool[readU32(bytes, aOff + 4)];
              const rawValIdx = readU32(bytes, aOff + 8);
              const valType = bytes[aOff + 15];
              const dataIdx = readU32(bytes, aOff + 16);
              const strVal = rawValIdx !== NO_INDEX ? pool[rawValIdx] : valType === TYPE_STRING ? pool[dataIdx] : undefined;
              if (aName === 'package' && strVal) packageName = strVal;
              if (aName === 'versionName' && strVal) versionName = strVal;
            }
            return { isBinaryAxml: true, packageName, versionName };
          }
        }
        cursor += chunkSize;
      }
      return { isBinaryAxml: true };
    } catch {
      return { isBinaryAxml: true };
    }
  }

  const text = new TextDecoder().decode(bytes);
  const pkgMatch = text.match(/package\s*=\s*["']([^"']+)["']/);
  const verMatch = text.match(/versionName\s*=\s*["']([^"']+)["']/);
  return {
    isBinaryAxml: false,
    packageName: pkgMatch?.[1],
    versionName: verMatch?.[1],
  };
}
