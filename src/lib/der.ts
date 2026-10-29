// Minimal ASN.1 DER encoder — enough to emit X.509 certificates and
// PKCS#7 SignedData blobs for APK (JAR / v1) signing, entirely in the browser.

export type Der = number[];

export function encLen(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

export function tlv(tag: number, content: number[]): number[] {
  return [tag, ...encLen(content.length), ...content];
}

export function seq(...parts: number[][]): number[] {
  return tlv(0x30, parts.flat());
}

export function setOf(...parts: number[][]): number[] {
  return tlv(0x31, parts.flat());
}

export function derInt(value: number[] | Uint8Array): number[] {
  let bytes = Array.from(value as Uint8Array);
  while (bytes.length > 1 && bytes[0] === 0x00) bytes = bytes.slice(1);
  if (bytes.length === 0) bytes = [0x00];
  if (bytes[0] & 0x80) bytes = [0x00, ...bytes];
  return tlv(0x02, bytes);
}

export function derIntSafe(n: number): number[] {
  const bytes: number[] = [];
  let v = n;
  if (v === 0) bytes.push(0);
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return derInt(bytes);
}

export function derBitString(content: number[] | Uint8Array, unusedBits = 0): number[] {
  return tlv(0x03, [unusedBits, ...Array.from(content as Uint8Array)]);
}

export function derOctetString(content: number[] | Uint8Array): number[] {
  return tlv(0x04, Array.from(content as Uint8Array));
}

export function derNull(): number[] {
  return [0x05, 0x00];
}

export function derOid(arcs: number[]): number[] {
  const body: number[] = [arcs[0] * 40 + arcs[1]];
  for (let i = 2; i < arcs.length; i++) {
    let v = arcs[i];
    const chunk: number[] = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    body.push(...chunk);
  }
  return tlv(0x06, body);
}

export function derUtf8(value: string): number[] {
  return tlv(0x0c, Array.from(new TextEncoder().encode(value)));
}

export function derPrintable(value: string): number[] {
  return tlv(0x13, Array.from(new TextEncoder().encode(value)));
}

export function derUtcTime(date: Date): number[] {
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  const year = date.getUTCFullYear();
  const stamp =
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds()) +
    'Z';
  // UTCTime only encodes 1950..2049 — anything beyond must use GeneralizedTime.
  if (year >= 1950 && year <= 2049) {
    return tlv(0x17, Array.from(new TextEncoder().encode(p(year % 100) + stamp)));
  }
  return tlv(0x18, Array.from(new TextEncoder().encode(p(year, 4) + stamp)));
}

export function derSequenceTag(tag: number, ...parts: number[][]): number[] {
  return tlv(tag, parts.flat());
}

export function toBase64(bytes: number[] | Uint8Array): string {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

export function fromBase64(b64: string): number[] {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out: number[] = new Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toPem(label: string, bytes: number[] | Uint8Array): string {
  const b64 = toBase64(bytes);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}
