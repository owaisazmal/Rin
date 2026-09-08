import { getRandomBytes } from 'expo-crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js';

/**
 * The backup code, and everything derived from it.
 *
 * There are no accounts here — no name, no email, no password — so this code
 * is the only secret in the design, and the phone is the only place it exists.
 * Two things come out of it, by separate derivations:
 *
 *   * the **id** a backup is filed under on the server, which the server sees;
 *   * the **key** its contents are encrypted with, which the server never sees.
 *
 * Separate `info` strings through HKDF mean the id tells you nothing about the
 * key: someone holding the whole database — Google, me, anyone who got in —
 * has a pile of ciphertext filed under opaque ids and no way to read any of it.
 * Restoring on a new phone is entering the code, which re-derives both.
 *
 * Losing the code loses the backup. Nothing on the phone is affected, and
 * there is deliberately no recovery path: a way to reset it would be a way in.
 */

/** 120 bits of entropy: 15 bytes, which is exactly 24 base32 characters */
const CODE_BYTES = 15;

/**
 * Crockford's base32: no I, L, O or U, so nothing reads as a digit it isn't
 * and the alphabet can't spell anything unfortunate.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Shown and typed in groups of four, which is where the dashes come from */
const GROUP = 4;

/** Separates this app's derivations from any other use of the same code */
const SALT = utf8ToBytes('rin.backup.v1');

const ID_INFO = utf8ToBytes('id');
const KEY_INFO = utf8ToBytes('key');

/** XChaCha20-Poly1305: 32-byte key, 24-byte nonce, authenticated */
const KEY_LENGTH = 32;
const NONCE_LENGTH = 24;

/** The format version travelling with every record, so this can change later */
export const BACKUP_FORMAT = 1;

/** One encrypted record, exactly as `firestore.rules` insists it look */
export interface Sealed {
  v: number;
  /** the nonce, base64 */
  iv: string;
  /** the ciphertext, base64 */
  ct: string;
}

// --- base32 -----------------------------------------------------------------

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

// --- base64 -----------------------------------------------------------------

// Hermes has atob/btoa but they speak binary strings rather than bytes, and
// this has to round-trip byte-for-byte on both platforms and in plain Node.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
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

export function fromBase64(text: string): Uint8Array | null {
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

// --- the code ---------------------------------------------------------------

/** A fresh code, formatted the way it is shown: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` */
export function generateCode(): string {
  return format(toBase32(getRandomBytes(CODE_BYTES)));
}

/** Groups of four, dash-separated */
export function format(code: string): string {
  return (code.match(new RegExp(`.{1,${GROUP}}`, 'g')) ?? []).join('-');
}

/**
 * What someone typed, reduced to what it meant: case ignored, dashes and
 * spaces ignored, and the letters Crockford leaves out mapped to the digits
 * they get mistaken for. Null if it still isn't a code.
 */
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
  if (!normalized) throw new Error('not a backup code');
  const bytes = fromBase32(normalized);
  if (!bytes) throw new Error('not a backup code');
  return hkdf(sha256, bytes, SALT, info, KEY_LENGTH);
}

/**
 * Where this backup lives on the server: 64 lowercase hex characters, which is
 * the shape `firestore.rules` will accept and nothing else. Knowing it is the
 * only way to reach the backup, and it cannot be listed or guessed.
 */
export function deriveBackupId(code: string): string {
  return bytesToHex(keyMaterial(code, ID_INFO));
}

/** The encryption key. Never leaves the phone, and is never written anywhere. */
export function deriveKey(code: string): Uint8Array {
  return keyMaterial(code, KEY_INFO);
}

// --- sealing ----------------------------------------------------------------

/** Encrypts one record. A fresh nonce every time, so the same month never repeats a ciphertext. */
export function seal(key: Uint8Array, plaintext: string): Sealed {
  const nonce = getRandomBytes(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));
  return { v: BACKUP_FORMAT, iv: toBase64(nonce), ct: toBase64(ciphertext) };
}

/**
 * Decrypts one record, or returns null.
 *
 * Null covers every way this can fail — the wrong code, a record from a newer
 * version of the app, a truncated field, a tampered ciphertext — because none
 * of them are worth telling apart to a caller whose only move is to say the
 * restore didn't work. Poly1305 means a modified ciphertext fails here rather
 * than decrypting to something plausible.
 */
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
