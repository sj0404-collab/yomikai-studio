// Pure-WebCrypto ZIP + 4-byte Zipalign + APK Signature Scheme v2 (APK Sig Block 42)
// writer and verifier for APKForge Studio.

import type { LoadedKey } from './keys';

const APK_SIG_BLOCK_MAGIC = 'APK Sig Block 42';
const APK_SIG_SCHEME_V2_ID = 0x7109871a;
const SIG_RSA_PKCS1_V1_5_SHA256 = 0x0103;
const CHUNK_SIZE = 1024 * 1024; // 1 MiB

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16le(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}

function u32le(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

function u64le(v: number): Uint8Array {
  const lo = v >>> 0;
  const hi = Math.floor(v / 0x100000000) >>> 0;
  return new Uint8Array([...u32le(lo), ...u32le(hi)]);
}

function readU16le(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

function readU32le(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function lp(payload: Uint8Array): Uint8Array {
  return concatBytes(u32le(payload.length), payload);
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const compressedStream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(compressedStream).arrayBuffer());
}

export interface ZipInputEntry {
  path: string;
  data: Uint8Array;
  store?: boolean; // true => STORED (uncompressed) + 4-byte zipaligned
}

async function computeApkV2ContentDigest(sections: Uint8Array[]): Promise<Uint8Array> {
  const chunkDigests: Uint8Array[] = [];
  for (const section of sections) {
    let offset = 0;
    while (offset < section.length) {
      const end = Math.min(offset + CHUNK_SIZE, section.length);
      const chunk = section.subarray(offset, end);
      const header = new Uint8Array(5);
      header[0] = 0xa5;
      header.set(u32le(chunk.length), 1);
      const chunkInput = concatBytes(header, chunk);
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new Uint8Array(chunkInput).buffer as ArrayBuffer),
      );
      chunkDigests.push(digest);
      offset = end;
    }
  }

  const topHeader = new Uint8Array(5);
  topHeader[0] = 0x5a;
  topHeader.set(u32le(chunkDigests.length), 1);
  const topInput = concatBytes(topHeader, ...chunkDigests);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(topInput).buffer as ArrayBuffer));
}

async function buildApkSigningBlockV2(
  beforeCentralDir: Uint8Array,
  centralDir: Uint8Array,
  eocdForDigest: Uint8Array,
  key: LoadedKey,
): Promise<Uint8Array> {
  const topDigest = await computeApkV2ContentDigest([beforeCentralDir, centralDir, eocdForDigest]);

  const digestEntry = lp(concatBytes(u32le(SIG_RSA_PKCS1_V1_5_SHA256), lp(topDigest)));
  const digests = lp(digestEntry);
  const certificates = lp(lp(new Uint8Array(key.certificateDer)));
  const additionalAttributes = u32le(0);

  const signedData = concatBytes(digests, certificates, additionalAttributes);
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new Uint8Array(signedData).buffer as ArrayBuffer),
  );

  const signatureEntry = lp(concatBytes(u32le(SIG_RSA_PKCS1_V1_5_SHA256), lp(sigBytes)));
  const signatures = lp(signatureEntry);
  const publicKey = lp(new Uint8Array(key.publicKeySpkiDer));

  const signer = lp(concatBytes(lp(signedData), signatures, publicKey));
  const v2Payload = lp(signer);

  // Pair: uint64 length (4-byte ID + payload.length), uint32 ID, payload
  const rawPair = concatBytes(u64le(4 + v2Payload.length), u32le(APK_SIG_SCHEME_V2_ID), v2Payload);

  // Pad pairs to 8-byte alignment if needed via a harmless padding pair (0x42726577)
  let pairs = rawPair;
  const rem = pairs.length % 8;
  if (rem !== 0) {
    let padTotal = 8 - rem;
    while (padTotal < 12) padTotal += 8;
    const padValLen = padTotal - 12;
    const padPair = concatBytes(u64le(4 + padValLen), u32le(0x42726577), new Uint8Array(padValLen));
    pairs = concatBytes(rawPair, padPair);
  }

  const magicBytes = new TextEncoder().encode(APK_SIG_BLOCK_MAGIC);
  const sizeOfBlock = pairs.length + 8 + 16;

  return concatBytes(u64le(sizeOfBlock), pairs, u64le(sizeOfBlock), magicBytes);
}

/** Package entries into a 4-byte zipaligned APK, optionally adding APK Signature Scheme v2. */
export async function writeAlignedApkZip(entries: ZipInputEntry[], v2Key: LoadedKey | null): Promise<Uint8Array> {
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  // Fixed DOS timestamp (2026-01-01 00:00:00) for deterministic archive headers
  const dosTime = 0x0000;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.path);
    const uncompressedSize = entry.data.length;
    const crc = crc32(entry.data);

    let method = 0;
    let payload = entry.data;
    if (!entry.store && entry.data.length > 0) {
      const deflated = await deflateRaw(entry.data);
      if (deflated.length < entry.data.length) {
        method = 8;
        payload = deflated;
      }
    }

    // 4-byte zipalign padding in Local File Header extra field for STORED entries
    let extraLen = 0;
    if (method === 0) {
      const unalignedDataOff = offset + 30 + nameBytes.length;
      extraLen = (4 - (unalignedDataOff % 4)) % 4;
    }
    const extra = new Uint8Array(extraLen);

    const localHeader = concatBytes(
      u32le(0x04034b50), // Local file header signature
      u16le(20), // Version needed to extract (2.0)
      u16le(0x0800), // UTF-8 filename flag
      u16le(method),
      u16le(dosTime),
      u16le(dosDate),
      u32le(crc),
      u32le(payload.length),
      u32le(uncompressedSize),
      u16le(nameBytes.length),
      u16le(extra.length),
      nameBytes,
      extra,
    );

    const cdHeader = concatBytes(
      u32le(0x02014b50), // Central directory file header signature
      u16le(20), // Version made by
      u16le(20), // Version needed
      u16le(0x0800), // UTF-8 flag
      u16le(method),
      u16le(dosTime),
      u16le(dosDate),
      u32le(crc),
      u32le(payload.length),
      u32le(uncompressedSize),
      u16le(nameBytes.length),
      u16le(0), // CD extra length
      u16le(0), // File comment length
      u16le(0), // Disk number start
      u16le(0), // Internal attrs
      u32le(0), // External attrs
      u32le(offset), // Relative offset of local header
      nameBytes,
    );

    localParts.push(localHeader, payload);
    cdParts.push(cdHeader);
    offset += localHeader.length + payload.length;
  }

  const beforeCentralDir = concatBytes(...localParts);
  const centralDir = concatBytes(...cdParts);

  const buildEocd = (cdOffset: number): Uint8Array =>
    concatBytes(
      u32le(0x06054b50),
      u16le(0),
      u16le(0),
      u16le(entries.length),
      u16le(entries.length),
      u32le(centralDir.length),
      u32le(cdOffset),
      u16le(0),
    );

  if (!v2Key) {
    return concatBytes(beforeCentralDir, centralDir, buildEocd(beforeCentralDir.length));
  }

  // EOCD for v2 digest uses the pre-signing-block offset (= start of APK Signing Block)
  const eocdForDigest = buildEocd(beforeCentralDir.length);
  const sigBlock = await buildApkSigningBlockV2(beforeCentralDir, centralDir, eocdForDigest, v2Key);
  const finalEocd = buildEocd(beforeCentralDir.length + sigBlock.length);

  return concatBytes(beforeCentralDir, sigBlock, centralDir, finalEocd);
}

export interface ApkBinaryVerification {
  validZip: boolean;
  zipAligned4: boolean;
  unalignedEntries: string[];
  hasV1Signature: boolean;
  hasV2Signature: boolean;
  signerCertDer?: Uint8Array;
  v2SignatureVerified: boolean;
}

/** Real binary verifier for `apksigner verify` and `zipalign -c 4` in the studio shell. */
export async function verifyApkBinary(bytes: Uint8Array): Promise<ApkBinaryVerification> {
  // Locate EOCD (last 22..65557 bytes)
  let eocdOff = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (readU32le(bytes, i) === 0x06054b50) {
      eocdOff = i;
      break;
    }
  }
  if (eocdOff < 0) {
    return {
      validZip: false,
      zipAligned4: false,
      unalignedEntries: [],
      hasV1Signature: false,
      hasV2Signature: false,
      v2SignatureVerified: false,
    };
  }

  const entryCount = readU16le(bytes, eocdOff + 10);
  const cdSize = readU32le(bytes, eocdOff + 12);
  const cdOff = readU32le(bytes, eocdOff + 16);

  const unalignedEntries: string[] = [];
  const names = new Set<string>();
  let cursor = cdOff;
  for (let i = 0; i < entryCount && cursor + 46 <= bytes.length; i++) {
    if (readU32le(bytes, cursor) !== 0x02014b50) break;
    const method = readU16le(bytes, cursor + 10);
    const fnLen = readU16le(bytes, cursor + 28);
    const exLen = readU16le(bytes, cursor + 30);
    const cmLen = readU16le(bytes, cursor + 32);
    const lhOff = readU32le(bytes, cursor + 42);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + fnLen));
    names.add(name);

    if (method === 0 && !name.endsWith('/') && lhOff + 30 <= bytes.length) {
      const lhFnLen = readU16le(bytes, lhOff + 26);
      const lhExLen = readU16le(bytes, lhOff + 28);
      const dataOff = lhOff + 30 + lhFnLen + lhExLen;
      if (dataOff % 4 !== 0) unalignedEntries.push(name);
    }
    cursor += 46 + fnLen + exLen + cmLen;
  }

  const hasV1Signature =
    names.has('META-INF/MANIFEST.MF') &&
    Array.from(names).some((n) => /^META-INF\/[^/]+\.SF$/i.test(n)) &&
    Array.from(names).some((n) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(n));

  // Check APK Sig Block 42 immediately preceding cdOff
  let hasV2Signature = false;
  let v2SignatureVerified = false;
  let signerCertDer: Uint8Array | undefined;

  if (cdOff >= 32) {
    const magic = new TextDecoder().decode(bytes.subarray(cdOff - 16, cdOff));
    if (magic === APK_SIG_BLOCK_MAGIC) {
      const sizeFooter = readU32le(bytes, cdOff - 24);
      const blockStart = cdOff - sizeFooter - 8;
      if (blockStart >= 0 && readU32le(bytes, blockStart) === sizeFooter) {
        let p = blockStart + 8;
        const pairsEnd = cdOff - 24;
        while (p + 12 <= pairsEnd) {
          const pairLen = readU32le(bytes, p);
          const id = readU32le(bytes, p + 8);
          if (id === APK_SIG_SCHEME_V2_ID) {
            hasV2Signature = true;
            try {
              const v2Val = bytes.subarray(p + 12, p + 8 + pairLen);
              const signers = v2Val.subarray(4, 4 + readU32le(v2Val, 0));
              const signer = signers.subarray(4, 4 + readU32le(signers, 0));
              const signedDataLen = readU32le(signer, 0);
              const signedData = signer.subarray(4, 4 + signedDataLen);
              let sPos = 4 + signedDataLen;
              const sigsLen = readU32le(signer, sPos);
              const sigs = signer.subarray(sPos + 4, sPos + 4 + sigsLen);
              sPos += 4 + sigsLen;
              const pubKeyLen = readU32le(signer, sPos);
              const pubKeySpki = signer.subarray(sPos + 4, sPos + 4 + pubKeyLen);

              // Extract cert from signedData
              const sdDigestsLen = readU32le(signedData, 0);
              const sdDigests = signedData.subarray(4, 4 + sdDigestsLen);
              const firstDigestEntry = sdDigests.subarray(4, 4 + readU32le(sdDigests, 0));
              const expectedDigest = firstDigestEntry.subarray(8, 8 + readU32le(firstDigestEntry, 4));

              const certsOff = 4 + sdDigestsLen;
              const certs = signedData.subarray(certsOff + 4, certsOff + 4 + readU32le(signedData, certsOff));
              signerCertDer = certs.slice(4, 4 + readU32le(certs, 0));

              // Extract RSA signature bytes
              const firstSigEntry = sigs.subarray(4, 4 + readU32le(sigs, 0));
              const sigBytes = firstSigEntry.subarray(8, 8 + readU32le(firstSigEntry, 4));

              const pubKey = await crypto.subtle.importKey(
                'spki',
                new Uint8Array(pubKeySpki).buffer as ArrayBuffer,
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                false,
                ['verify'],
              );
              const sigOk = await crypto.subtle.verify(
                'RSASSA-PKCS1-v1_5',
                pubKey,
                new Uint8Array(sigBytes).buffer as ArrayBuffer,
                new Uint8Array(signedData).buffer as ArrayBuffer,
              );

              // Recompute chunked digest over (beforeBlock, CD, patched EOCD)
              const section1 = bytes.subarray(0, blockStart);
              const section3 = bytes.subarray(cdOff, cdOff + cdSize);
              const eocdCopy = bytes.slice(eocdOff);
              eocdCopy.set(u32le(blockStart), 16);
              const actualDigest = await computeApkV2ContentDigest([section1, section3, eocdCopy]);
              const digestMatch =
                actualDigest.length === expectedDigest.length &&
                actualDigest.every((b, idx) => b === expectedDigest[idx]);

              v2SignatureVerified = sigOk && digestMatch;
            } catch {
              v2SignatureVerified = false;
            }
            break;
          }
          p += 8 + pairLen;
        }
      }
    }
  }

  return {
    validZip: true,
    zipAligned4: unalignedEntries.length === 0,
    unalignedEntries,
    hasV1Signature,
    hasV2Signature,
    signerCertDer,
    v2SignatureVerified,
  };
}
