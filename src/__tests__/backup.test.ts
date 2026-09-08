import {
  BACKUP_FORMAT,
  Sealed,
  deriveBackupId,
  deriveKey,
  format,
  fromBase64,
  generateCode,
  normalizeCode,
  open,
  seal,
  toBase64,
} from '../backup';

/**
 * The backup code is the only secret in the design, so this is where the
 * design is checked: that a code round-trips, that the id it is filed under
 * gives nothing away about the key it is encrypted with, and that anything
 * short of the right code fails cleanly rather than half-working.
 */

/** Deterministic bytes, so a test can name the code it is about to get */
let mockNextRandom: Uint8Array | null = null;
jest.mock('expo-crypto', () => ({
  __esModule: true,
  getRandomBytes: jest.fn((n: number) => {
    const bytes = mockNextRandom ?? new Uint8Array(n).fill(7);
    mockNextRandom = null;
    return bytes.slice(0, n);
  }),
}));

afterEach(() => {
  mockNextRandom = null;
});

const CODE = generateCode();

describe('the code', () => {
  it('is 24 characters in six dashed groups of four', () => {
    expect(CODE).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
    expect(CODE.replace(/-/g, '')).toHaveLength(24);
  });

  it('never contains the letters Crockford leaves out', () => {
    mockNextRandom = new Uint8Array(15).fill(0xff);
    expect(generateCode()).not.toMatch(/[ILOU]/);
  });

  it('reads back what was typed, however it was typed', () => {
    const canonical = normalizeCode(CODE);
    expect(canonical).toBe(CODE.replace(/-/g, ''));
    expect(normalizeCode(CODE.toLowerCase())).toBe(canonical);
    expect(normalizeCode(CODE.replace(/-/g, ' '))).toBe(canonical);
    expect(normalizeCode(` ${CODE} `)).toBe(canonical);
  });

  it('forgives the letters that look like digits', () => {
    const typed = CODE.replace(/0/g, 'O').replace(/1/g, 'l');
    expect(normalizeCode(typed)).toBe(normalizeCode(CODE));
  });

  it.each([
    ['empty', ''],
    ['too short', 'ABCD-ABCD'],
    ['too long', `${CODE}-ABCD`],
    ['a character outside the alphabet', `${CODE.slice(0, -1)}$`],
  ])('refuses %s', (_, input) => {
    expect(normalizeCode(input)).toBeNull();
  });

  it('formats a bare code back into groups', () => {
    expect(format('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});

describe('what the code derives', () => {
  it('gives an id of the exact shape the rules accept', () => {
    expect(deriveBackupId(CODE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same id and key however the code was typed', () => {
    const messy = ` ${CODE.toLowerCase().replace(/-/g, '')} `;
    expect(deriveBackupId(messy)).toBe(deriveBackupId(CODE));
    expect(deriveKey(messy)).toEqual(deriveKey(CODE));
  });

  it('gives a different id and key to a different code', () => {
    mockNextRandom = new Uint8Array(15).fill(1);
    const other = generateCode();
    expect(deriveBackupId(other)).not.toBe(deriveBackupId(CODE));
    expect(deriveKey(other)).not.toEqual(deriveKey(CODE));
  });

  it('does not let the id, which the server sees, reveal the key, which it does not', () => {
    // separate HKDF info strings: the two must share no material
    const id = deriveBackupId(CODE);
    const key = deriveKey(CODE);
    expect(key).toHaveLength(32);
    expect(Buffer.from(key).toString('hex')).not.toBe(id);
  });

  it('refuses to derive anything from something that is not a code', () => {
    expect(() => deriveBackupId('nonsense')).toThrow();
    expect(() => deriveKey('nonsense')).toThrow();
  });
});

describe('sealing a record', () => {
  const key = deriveKey(CODE);
  const plaintext = JSON.stringify({ habits: [{ id: '0', name: 'Run' }], grid: { '1:0': 1 } });

  it('round-trips', () => {
    expect(open(key, seal(key, plaintext))).toBe(plaintext);
  });

  it('round-trips text that is not ASCII', () => {
    const unicode = JSON.stringify({ observations: ['凛 — 走った 🏃'] });
    expect(open(key, seal(key, unicode))).toBe(unicode);
  });

  it('round-trips an empty string', () => {
    expect(open(key, seal(key, ''))).toBe('');
  });

  it('produces a record of exactly the shape the rules accept', () => {
    mockNextRandom = new Uint8Array(24).fill(3);
    const record = seal(key, plaintext);
    expect(Object.keys(record).sort()).toEqual(['ct', 'iv', 'v']);
    expect(record.v).toBe(BACKUP_FORMAT);
    // the rules require the nonce between 16 and 32 characters
    expect(record.iv.length).toBeGreaterThanOrEqual(16);
    expect(record.iv.length).toBeLessThanOrEqual(32);
    expect(record.ct.length).toBeGreaterThan(0);
  });

  it('never repeats a ciphertext for the same input', () => {
    const first = seal(key, plaintext);
    mockNextRandom = new Uint8Array(24).fill(9);
    const second = seal(key, plaintext);
    expect(second.ct).not.toBe(first.ct);
    expect(open(key, second)).toBe(plaintext);
  });
});

describe('opening a record that should not open', () => {
  const key = deriveKey(CODE);
  const record = seal(key, 'the real contents');

  it('refuses the wrong code', () => {
    mockNextRandom = new Uint8Array(15).fill(2);
    expect(open(deriveKey(generateCode()), record)).toBeNull();
  });

  it('refuses a tampered ciphertext rather than returning something plausible', () => {
    const flipped = fromBase64(record.ct)!;
    flipped[0] ^= 1;
    expect(open(key, { ...record, ct: toBase64(flipped) })).toBeNull();
  });

  it('refuses a swapped nonce', () => {
    expect(open(key, { ...record, iv: toBase64(new Uint8Array(24).fill(1)) })).toBeNull();
  });

  it.each([
    ['a newer format version', { v: BACKUP_FORMAT + 1 }],
    ['a nonce of the wrong length', { iv: toBase64(new Uint8Array(12)) }],
    ['a nonce that is not base64', { iv: '!!!!' }],
    ['ciphertext that is not base64', { ct: '!!!!' }],
    ['empty ciphertext', { ct: '' }],
  ])('refuses %s', (_, over) => {
    expect(open(key, { ...record, ...over } as Sealed)).toBeNull();
  });

  it('refuses a record that is missing fields entirely', () => {
    expect(open(key, {} as Sealed)).toBeNull();
    expect(open(key, undefined as unknown as Sealed)).toBeNull();
  });
});

describe('base64', () => {
  it('round-trips every byte value at every alignment', () => {
    for (let length = 0; length < 5; length++) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37) & 255);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
    const all = new Uint8Array(256).map((_, i) => i);
    expect(fromBase64(toBase64(all))).toEqual(all);
  });

  it('rejects what is not base64', () => {
    expect(fromBase64('a')).toBeNull();
    expect(fromBase64('****')).toBeNull();
  });
});
