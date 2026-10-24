import { getRandomBytes } from 'expo-crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js';

// The code is the only secret: HKDF derives both the server-visible id and the never-sent key.

// 120 bits: exactly 24 base32 characters
const CODE_BYTES = 15;

// Crockford's base32: no I, L, O or U
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const GROUP = 4;

const SALT = utf8ToBytes('rin.backup.v1');

const ID_INFO = utf8ToBytes('id');
const KEY_INFO = utf8ToBytes('key');

// XChaCha20-Poly1305
const KEY_LENGTH = 32;
const NONCE_LENGTH = 24;

// the Poly1305 tag the cipher appends
const TAG_LENGTH = 16;

const BACKUP_FORMAT = 1;

// one encrypted record, in the shape firestore.rules accepts; iv and ct are base64
export interface Sealed {
  v: number;
  iv: string;
  ct: string;
}

function toBase32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Uint8Array | null {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// hand-rolled because Hermes' atob/btoa work on binary strings, not bytes
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >>> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >>> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >>> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) return null;
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 6) | B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
export function generateCode(): string {
  return format(toBase32(getRandomBytes(CODE_BYTES)));
}

export function format(code: string): string {
  return (code.match(new RegExp(`.{1,${GROUP}}`, 'g')) ?? []).join('-');
}

// Case, dashes and spaces ignored, and I/L/O read as the digits they get mistaken for.
export function normalizeCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (cleaned.length !== Math.ceil((CODE_BYTES * 8) / 5)) return null;
  const bytes = fromBase32(cleaned);
  return bytes && bytes.length === CODE_BYTES ? cleaned : null;
}

function keyMaterial(code: string, info: Uint8Array): Uint8Array {
  const normalized = normalizeCode(code);
  const bytes = normalized && fromBase32(normalized);
  if (!bytes) throw new Error('not a backup code');
  return hkdf(sha256, bytes, SALT, info, KEY_LENGTH);
}

// 64 lowercase hex characters, the only id shape firestore.rules accepts
export function deriveBackupId(code: string): string {
  return bytesToHex(keyMaterial(code, ID_INFO));
}

// never leaves the phone and is never written anywhere
export function deriveKey(code: string): Uint8Array {
  return keyMaterial(code, KEY_INFO);
}

// a fresh nonce every time, so the same month never repeats a ciphertext
export function seal(key: Uint8Array, plaintext: string): Sealed {
  const nonce = getRandomBytes(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));
  return { v: BACKUP_FORMAT, iv: toBase64(nonce), ct: toBase64(ciphertext) };
}

// The caps firestore.rules puts on `ct`, in base64 characters; change both together.
export const MAX_MONTH_CT = 65536;
export const MAX_TASKS_CT = 262144;

// Exactly how long `seal`'s ct will be, from UTF-8 bytes plus the tag, without encrypting.
export function ciphertextChars(plaintext: string): number {
  return 4 * Math.ceil((utf8ToBytes(plaintext).length + TAG_LENGTH) / 3);
}

// Null for every failure: wrong code, newer format, truncated or tampered record.
export function open(key: Uint8Array, record: Sealed): string | null {
  if (record?.v !== BACKUP_FORMAT) return null;
  const nonce = fromBase64(record.iv ?? '');
  const ciphertext = fromBase64(record.ct ?? '');
  if (!nonce || nonce.length !== NONCE_LENGTH || !ciphertext) return null;
  try {
    return bytesToUtf8(xchacha20poly1305(key, nonce).decrypt(ciphertext));
  } catch {
    return null;
  }
}
