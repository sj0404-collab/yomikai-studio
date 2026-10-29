// Binary Android Resource Table (resources.arsc) & PNG launcher icon generator.
// Emits a valid RES_TABLE_TYPE (0x0002) chunk parseable by AAPT / Android Runtime
// (libandroidfw), defining @string/app_name (0x7f010000) and @drawable/ic_launcher (0x7f020000).

function u8(v: number): number {
  return v & 0xff;
}

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function align4Bytes(bytes: number[]): number[] {
  const out = [...bytes];
  while (out.length % 4 !== 0) out.push(0);
  return out;
}

/** Build a UTF-16LE ResStringPool_header (0x0001) chunk. */
export function buildUtf16StringPool(strings: string[]): Uint8Array {
  const headerSize = 28;
  const offsets: number[] = [];
  const data: number[] = [];

  for (const s of strings) {
    offsets.push(data.length);
    const len = s.length;
    data.push(...u16(len));
    for (let i = 0; i < len; i++) {
      data.push(...u16(s.charCodeAt(i)));
    }
    data.push(0x00, 0x00); // UTF-16 NUL terminator
  }

  const paddedData = align4Bytes(data);
  const stringsStart = headerSize + strings.length * 4;
  const chunkSize = stringsStart + paddedData.length;

  const out: number[] = [
    ...u16(0x0001), // RES_STRING_POOL_TYPE
    ...u16(headerSize),
    ...u32(chunkSize),
    ...u32(strings.length),
    ...u32(0), // styleCount
    ...u32(0), // flags (UTF-16LE)
    ...u32(stringsStart),
    ...u32(0), // stylesStart
    ...offsets.flatMap((o) => u32(o)),
    ...paddedData,
  ];
  return new Uint8Array(out);
}

function buildTypeSpecChunk(typeId: number, entryCount: number): number[] {
  const headerSize = 16;
  const chunkSize = headerSize + entryCount * 4;
  return [
    ...u16(0x0202), // RES_TABLE_TYPE_SPEC_TYPE
    ...u16(headerSize),
    ...u32(chunkSize),
    u8(typeId),
    0x00,
    0x00,
    0x00,
    ...u32(entryCount),
    ...new Array(entryCount).fill(0).flatMap(() => u32(0x40000000)), // SPEC_PUBLIC
  ];
}

function buildSingleStringEntryTypeChunk(typeId: number, keyIdx: number, globalStringIdx: number): number[] {
  const configSize = 56;
  const headerSize = 20 + configSize; // 76 bytes
  const entriesStart = headerSize + 4; // 1 entry offset (4 bytes)
  const entryBytes = [
    ...u16(8), // ResTable_entry.size
    ...u16(0x0002), // FLAG_PUBLIC
    ...u32(keyIdx), // key string pool index
    ...u16(8), // Res_value.size
    0x00, // res0
    0x03, // TYPE_STRING
    ...u32(globalStringIdx), // index into global value string pool
  ];
  const chunkSize = entriesStart + entryBytes.length;

  const configBytes = [...u32(configSize), ...new Array(configSize - 4).fill(0)];

  return [
    ...u16(0x0201), // RES_TABLE_TYPE_TYPE
    ...u16(headerSize),
    ...u32(chunkSize),
    u8(typeId),
    0x00,
    0x00,
    0x00,
    ...u32(1), // entryCount
    ...u32(entriesStart),
    ...configBytes,
    ...u32(0), // entry[0] offset = 0
    ...entryBytes,
  ];
}

export const RES_ID_APP_NAME = 0x7f010000;
export const RES_ID_IC_LAUNCHER = 0x7f020000;
export const ICON_APK_PATH = 'res/drawable/ic_launcher.png';

/** Build a valid uncompressed resources.arsc table for packageName + appLabel. */
export function buildResourcesArsc(opts: { packageName: string; appLabel: string }): Uint8Array {
  const globalPool = Array.from(buildUtf16StringPool([opts.appLabel || 'APKForge App', ICON_APK_PATH]));
  const typePool = Array.from(buildUtf16StringPool(['string', 'drawable']));
  const keyPool = Array.from(buildUtf16StringPool(['app_name', 'ic_launcher']));

  const stringTypeSpec = buildTypeSpecChunk(1, 1);
  const stringType = buildSingleStringEntryTypeChunk(1, 0, 0); // @string/app_name -> globalPool[0]
  const drawableTypeSpec = buildTypeSpecChunk(2, 1);
  const drawableType = buildSingleStringEntryTypeChunk(2, 1, 1); // @drawable/ic_launcher -> globalPool[1]

  const pkgHeaderSize = 288;
  const nameBytes = new Array(256).fill(0);
  const pkgName = opts.packageName.slice(0, 127);
  for (let i = 0; i < pkgName.length; i++) {
    const code = pkgName.charCodeAt(i);
    nameBytes[i * 2] = code & 0xff;
    nameBytes[i * 2 + 1] = (code >>> 8) & 0xff;
  }

  const typeStringsOff = pkgHeaderSize;
  const keyStringsOff = typeStringsOff + typePool.length;
  const pkgBody = [
    ...typePool,
    ...keyPool,
    ...stringTypeSpec,
    ...stringType,
    ...drawableTypeSpec,
    ...drawableType,
  ];
  const pkgChunkSize = pkgHeaderSize + pkgBody.length;

  const pkgChunk = [
    ...u16(0x0200), // RES_TABLE_PACKAGE_TYPE
    ...u16(pkgHeaderSize),
    ...u32(pkgChunkSize),
    ...u32(0x7f), // user package ID
    ...nameBytes,
    ...u32(typeStringsOff),
    ...u32(2), // lastPublicType
    ...u32(keyStringsOff),
    ...u32(2), // lastPublicKey
    ...u32(0), // typeIdOffset
    ...pkgBody,
  ];

  const tableHeaderSize = 12;
  const totalSize = tableHeaderSize + globalPool.length + pkgChunk.length;

  const out = [
    ...u16(0x0002), // RES_TABLE_TYPE
    ...u16(tableHeaderSize),
    ...u32(totalSize),
    ...u32(1), // packageCount
    ...globalPool,
    ...pkgChunk,
  ];

  return new Uint8Array(out);
}

/** Generate a valid 64x64 RGBA PNG launcher icon so real Android devices render a crisp app icon. */
export async function buildLauncherIconPng(): Promise<Uint8Array> {
  const width = 64;
  const height = 64;
  // Raw scanlines: filter byte (0) + width * 4 RGBA bytes
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 4);
    raw[rowOff] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const px = rowOff + 1 + x * 4;
      const dx = x - 31.5;
      const dy = y - 31.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 29.5) {
        // Rounded dark background
        raw[px] = 15;
        raw[px + 1] = 20;
        raw[px + 2] = 27;
        raw[px + 3] = 255;
      } else if (dist > 16 && dist < 23) {
        // Android green ring (#3ddc84)
        raw[px] = 61;
        raw[px + 1] = 220;
        raw[px + 2] = 132;
        raw[px + 3] = 255;
      } else if (dist <= 9) {
        // Accent core (#2f81f7)
        raw[px] = 47;
        raw[px + 1] = 129;
        raw[px + 2] = 247;
        raw[px + 3] = 255;
      } else {
        raw[px] = 21;
        raw[px + 1] = 28;
        raw[px + 2] = 37;
        raw[px + 3] = 255;
      }
    }
  }

  // Compress raw scanlines using standard zlib ("deflate") stream via pipeThrough (never deadlocks on backpressure)
  const compressedStream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const idatData = new Uint8Array(await new Response(compressedStream).arrayBuffer());

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32be = (typeBytes: number[], payload: Uint8Array): number[] => {
    let c = 0xffffffff;
    for (const b of typeBytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    for (let i = 0; i < payload.length; i++) c = crcTable[(c ^ payload[i]) & 0xff] ^ (c >>> 8);
    const v = (c ^ 0xffffffff) >>> 0;
    return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  };
  const u32be = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const pngChunk = (type: string, payload: Uint8Array): number[] => {
    const t = Array.from(new TextEncoder().encode(type));
    return [...u32be(payload.length), ...t, ...Array.from(payload), ...crc32be(t, payload)];
  };

  const ihdr = new Uint8Array([
    ...u32be(width),
    ...u32be(height),
    8, // bit depth
    6, // color type RGBA
    0, // compression
    0, // filter
    0, // interlace
  ]);

  const pngBytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', ihdr),
    ...pngChunk('IDAT', idatData),
    ...pngChunk('IEND', new Uint8Array(0)),
  ];
  return new Uint8Array(pngBytes);
}
