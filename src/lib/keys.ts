// Browser-native Android signing keys: RSA keypairs generated with WebCrypto,
// RFC 5280-compliant self-signed X.509 v3 certificates (DER), and APK v1 (JAR)
// signing producing verifiable META-INF/MANIFEST.MF, CERT.SF and CERT.RSA entries.

import {
  derBitString,
  derIntSafe,
  derNull,
  derOid,
  derOctetString,
  derPrintable,
  derSequenceTag,
  derUtcTime,
  derUtf8,
  fromBase64,
  seq,
  setOf,
  toBase64,
  toPem,
  tlv,
  type Der,
} from './der';

const OID = {
  rsaEncryption: [1, 2, 840, 113549, 1, 1, 1],
  sha256WithRSA: [1, 2, 840, 113549, 1, 1, 11],
  sha256: [2, 16, 840, 1, 101, 3, 4, 2, 1],
  commonName: [2, 5, 4, 3],
  country: [2, 5, 4, 6],
  locality: [2, 5, 4, 7],
  stateOrProvince: [2, 5, 4, 8],
  organization: [2, 5, 4, 10],
  organizationalUnit: [2, 5, 4, 11],
  pkcs7SignedData: [1, 2, 840, 113549, 1, 7, 2],
  pkcs7Data: [1, 2, 840, 113549, 1, 7, 1],
  basicConstraints: [2, 5, 29, 19],
  keyUsage: [2, 5, 29, 15],
  extKeyUsage: [2, 5, 29, 37],
  codeSigning: [1, 3, 6, 1, 5, 5, 7, 3, 3],
} as const;

export interface SigningKey {
  id: string;
  label: string;
  alias: string;
  storePassword: string;
  keyPassword: string;
  subject: string;
  issuer: string;
  validDays: number;
  createdAt: string;
  bits: number;
  fingerprintSha256: string;
  certificatePem: string;
  privateKeyPem: string;
  serialHex: string;
}

export interface LoadedKey extends SigningKey {
  privateKey: CryptoKey;
  certificateDer: number[];
  publicKeySpkiDer: number[];
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PRINTABLE_RE = /^[A-Za-z0-9 '()+,\-./:=?]*$/;

function encodeDnValue(key: string, value: string): Der {
  if (key === 'C' || PRINTABLE_RE.test(value)) {
    return derPrintable(value);
  }
  return derUtf8(value);
}

function nameFromDistinguishedName(dn: string): Der {
  const safeDn = (dn || 'CN=Android Debug, O=Android, C=US').trim();
  const parts = safeDn
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const idx = p.indexOf('=');
      const key = (idx >= 0 ? p.slice(0, idx) : 'CN').trim().toUpperCase();
      const value = idx >= 0 ? p.slice(idx + 1).trim() : p.trim();
      let oid: readonly number[];
      if (key === 'CN') oid = OID.commonName;
      else if (key === 'OU') oid = OID.organizationalUnit;
      else if (key === 'O') oid = OID.organization;
      else if (key === 'L') oid = OID.locality;
      else if (key === 'ST' || key === 'S') oid = OID.stateOrProvince;
      else if (key === 'C') oid = OID.country;
      else oid = OID.commonName;
      return setOf(seq(derOid([...oid]), encodeDnValue(key, value)));
    });
  return seq(...parts);
}

function algorithmIdentifier(oid: readonly number[], withNull = true): Der {
  return withNull ? seq(derOid([...oid]), derNull()) : seq(derOid([...oid]));
}

function readTlv(buf: Uint8Array, at: number): { tag: number; content: number[]; raw: number[]; end: number } {
  const tag = buf[at];
  let len = buf[at + 1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + buf[at + 2 + k];
    header = 2 + n;
  }
  const end = at + header + len;
  return {
    tag,
    content: Array.from(buf.slice(at + header, end)),
    raw: Array.from(buf.slice(at, end)),
    end,
  };
}

/** Pull the SubjectPublicKeyInfo TLV out of a DER-encoded X.509 certificate. */
export function extractSpkiFromCertificateDer(certDer: number[]): number[] {
  const certBuf = Uint8Array.from(certDer);
  const outer = readTlv(certBuf, 0); // Certificate SEQUENCE
  const outerBytes = Uint8Array.from(outer.content);
  const tbs = readTlv(outerBytes, 0); // TBSCertificate SEQUENCE
  const tbsBytes = Uint8Array.from(tbs.content);

  let pos = 0;
  const first = readTlv(tbsBytes, pos);
  // Optional [0] EXPLICIT Version
  if (first.tag === 0xa0) {
    pos = first.end;
  }
  // Skip serialNumber, signature, issuer, validity, subject (5 elements)
  for (let i = 0; i < 5; i++) {
    const el = readTlv(tbsBytes, pos);
    pos = el.end;
  }
  const spki = readTlv(tbsBytes, pos);
  return spki.raw;
}

/** Pull the raw RSAPublicKey (modulus + exponent) out of a SubjectPublicKeyInfo DER. */
function extractRsaPublicKey(spki: Uint8Array): number[] {
  const outer = readTlv(spki, 0); // SEQUENCE
  const outerBytes = Uint8Array.from(outer.content);
  const alg = readTlv(outerBytes, 0); // AlgorithmIdentifier
  const bitsTlv = readTlv(outerBytes, alg.end); // BIT STRING
  const keySeq = readTlv(Uint8Array.from(bitsTlv.content.slice(1)), 0); // RSAPublicKey SEQUENCE
  return tlv(keySeq.tag, keySeq.content);
}

export async function createSigningKey(opts: {
  label: string;
  alias: string;
  storePassword?: string;
  keyPassword?: string;
  subject: string;
  validDays?: number;
  bits?: number;
}): Promise<LoadedKey> {
  const bits = opts.bits ?? 2048;
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: bits,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

  const notBefore = new Date(Date.now() - 60_000);
  const validDays = opts.validDays ?? 10000;
  const notAfter = new Date(notBefore.getTime() + validDays * 86400000);
  // Positive 31-bit serial integer so ASN.1 INTEGER is strictly positive
  const serial = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) || 1;

  const rsaPub = extractRsaPublicKey(spki);
  const name = nameFromDistinguishedName(opts.subject);

  // RFC 5280 §4.2.1.9 BasicConstraints: empty SEQUENCE => cA=FALSE, no pathLenConstraint
  // RFC 5280 §4.2.1.3 KeyUsage: bit 0 (MSB 0x80, 7 unused bits) = digitalSignature
  // RFC 5280 §4.2.1.12 ExtKeyUsage: id-kp-codeSigning
  const extensions = seq(
    seq(derOid([...OID.basicConstraints]), derOctetString(seq())),
    seq(derOid([...OID.keyUsage]), derOctetString(derBitString([0x80], 7))),
    seq(derOid([...OID.extKeyUsage]), derOctetString(seq(derOid([...OID.codeSigning])))),
  );

  const tbs = seq(
    derSequenceTag(0xa0, derIntSafe(2)),
    derIntSafe(serial),
    algorithmIdentifier(OID.sha256WithRSA),
    name,
    seq(derUtcTime(notBefore), derUtcTime(notAfter)),
    name,
    seq(algorithmIdentifier(OID.rsaEncryption), derBitString(rsaPub)),
    derSequenceTag(0xa3, extensions),
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new Uint8Array(tbs)),
  );

  const certificateDer = seq(tbs, algorithmIdentifier(OID.sha256WithRSA), derBitString(signature));

  const certDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(certificateDer)));
  const fingerprint = bytesToHex(Array.from(certDigest)).replace(/(..)(?=.)/g, '$1:').toUpperCase();

  const key: SigningKey = {
    id: `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: opts.label,
    alias: opts.alias,
    storePassword: opts.storePassword ?? 'android',
    keyPassword: opts.keyPassword ?? 'android',
    subject: opts.subject,
    issuer: opts.subject,
    validDays,
    createdAt: notBefore.toISOString(),
    bits,
    fingerprintSha256: fingerprint,
    certificatePem: toPem('CERTIFICATE', certificateDer),
    privateKeyPem: toPem('PRIVATE KEY', pkcs8),
    serialHex: serial.toString(16).padStart(8, '0').toUpperCase(),
  };

  return {
    ...key,
    privateKey: pair.privateKey,
    certificateDer,
    publicKeySpkiDer: Array.from(spki),
  };
}

export async function importSigningKey(key: SigningKey): Promise<LoadedKey | null> {
  try {
    const pkcs8 = fromBase64(key.privateKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      new Uint8Array(pkcs8),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['sign'],
    );
    const certDer = fromBase64(key.certificatePem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
    const publicKeySpkiDer = extractSpkiFromCertificateDer(certDer);
    return { ...key, privateKey, certificateDer: certDer, publicKeySpkiDer };
  } catch {
    return null;
  }
}

export interface SignedEntry {
  path: string;
  bytes: number[] | Uint8Array;
}

async function digestBase64(bytes: number[] | Uint8Array): Promise<string> {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buf = new Uint8Array(arr).buffer as ArrayBuffer;
  const d = await crypto.subtle.digest('SHA-256', buf);
  return toBase64(new Uint8Array(d));
}

/** Build META-INF/MANIFEST.MF (v1 JAR manifest). */
export async function buildManifest(entries: SignedEntry[]): Promise<string> {
  const lines: string[] = ['Manifest-Version: 1.0', 'Created-By: 1.0 (APKForge Studio)', ''];
  for (const entry of entries) {
    const b64 = await digestBase64(entry.bytes);
    lines.push('Name: ' + entry.path);
    lines.push('SHA-256-Digest: ' + b64);
    lines.push('');
  }
  return lines.join('\r\n');
}

/** Build META-INF/CERT.SF (signature file over the manifest, including X-Android-APK-Signed: 2). */
export async function buildSignatureFile(manifest: string, apkSigSchemeV2 = true): Promise<string> {
  const manifestBytes = new TextEncoder().encode(manifest);
  const mainDigestB64 = await digestBase64(manifestBytes);
  const lines: string[] = [
    'Signature-Version: 1.0',
    'Created-By: 1.0 (APKForge Studio)',
    'SHA-256-Digest-Manifest: ' + mainDigestB64,
  ];
  if (apkSigSchemeV2) {
    lines.push('X-Android-APK-Signed: 2');
  }
  lines.push('');

  const sections = manifest.split('\r\n\r\n').filter((s) => s.startsWith('Name: '));
  for (const section of sections) {
    const sectionBytes = new TextEncoder().encode(section + '\r\n\r\n');
    const sectionB64 = await digestBase64(sectionBytes);
    const name = section.split('\r\n')[0].replace('Name: ', '');
    lines.push('Name: ' + name);
    lines.push('SHA-256-Digest: ' + sectionB64);
    lines.push('');
  }
  return lines.join('\r\n');
}

/** Extract issuer Name TLV and serial INTEGER TLV directly from certificateDer so SignerInfo matches byte-for-byte. */
function extractIssuerAndSerialFromCert(certDer: number[], fallbackIssuerDn: string, fallbackSerial: number): {
  issuerRaw: number[];
  serialRaw: number[];
} {
  try {
    const outer = readTlv(Uint8Array.from(certDer), 0);
    const tbs = readTlv(Uint8Array.from(outer.content), 0);
    const tbsBytes = Uint8Array.from(tbs.content);
    let pos = 0;
    const first = readTlv(tbsBytes, pos);
    if (first.tag === 0xa0) pos = first.end;
    const serialTlv = readTlv(tbsBytes, pos);
    pos = serialTlv.end;
    const sigAlg = readTlv(tbsBytes, pos);
    pos = sigAlg.end;
    const issuerTlv = readTlv(tbsBytes, pos);
    return { issuerRaw: issuerTlv.raw, serialRaw: serialTlv.raw };
  } catch {
    return {
      issuerRaw: nameFromDistinguishedName(fallbackIssuerDn),
      serialRaw: derIntSafe(fallbackSerial),
    };
  }
}

/** Build META-INF/CERT.RSA — a PKCS#7 SignedData with a detached SHA-256 signature. */
export async function buildPkcs7(
  certDer: number[],
  sfBytes: number[] | Uint8Array,
  privateKey: CryptoKey,
  issuerDn: string,
  serial: number,
): Promise<number[]> {
  const sfArr = sfBytes instanceof Uint8Array ? sfBytes : new Uint8Array(sfBytes);
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new Uint8Array(sfArr).buffer as ArrayBuffer),
  );

  const { issuerRaw, serialRaw } = extractIssuerAndSerialFromCert(certDer, issuerDn, serial);

  const signerInfo = seq(
    derIntSafe(1),
    seq(issuerRaw, serialRaw),
    algorithmIdentifier(OID.sha256),
    algorithmIdentifier(OID.rsaEncryption),
    derOctetString(Array.from(signature)),
  );

  const signedData = seq(
    derIntSafe(1),
    setOf(algorithmIdentifier(OID.sha256)),
    seq(derOid([...OID.pkcs7Data])),
    derSequenceTag(0xa0, certDer),
    setOf(signerInfo),
  );

  return seq(derOid([...OID.pkcs7SignedData]), derSequenceTag(0xa0, signedData));
}

export async function sha256Hex(bytes: number[] | Uint8Array): Promise<string> {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = await crypto.subtle.digest('SHA-256', new Uint8Array(arr).buffer as ArrayBuffer);
  return hex(d);
}
