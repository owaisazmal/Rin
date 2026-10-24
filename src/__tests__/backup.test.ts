import {
  MAX_MONTH_CT,
  MAX_TASKS_CT,
  Sealed,
  ciphertextChars,
  deriveBackupId,
  deriveKey,
  format,
  generateCode,
  normalizeCode,
  open,
  seal,
} from '../backup';

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

// deterministic bytes, so a test can name the code it is about to get
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
    expect(record.v).toBe(1);
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

describe('knowing how big a record will be before sending it', () => {
  const key = deriveKey(CODE);

  it('counts the tag and the base64 padding, so even nothing is 24 characters', () => {
    expect(ciphertextChars('')).toBe(24);
    expect(ciphertextChars('a')).toBe(24);
    expect(ciphertextChars('ab')).toBe(24);
    expect(ciphertextChars('abc')).toBe(28);
    expect(ciphertextChars('a'.repeat(1000))).toBe(1356);
  });

  it('puts the largest month that fits exactly on the limit', () => {
    expect(ciphertextChars('a'.repeat(49136))).toBe(MAX_MONTH_CT);
    expect(ciphertextChars('a'.repeat(49137))).toBeGreaterThan(MAX_MONTH_CT);
    expect(ciphertextChars('a'.repeat(49137))).toBe(65540);
  });

  it('puts the largest task list that fits exactly on the limit', () => {
    expect(ciphertextChars('a'.repeat(196592))).toBe(MAX_TASKS_CT);
    expect(ciphertextChars('a'.repeat(196593))).toBeGreaterThan(MAX_TASKS_CT);
    expect(ciphertextChars('a'.repeat(196593))).toBe(262148);
  });

  it('measures UTF-8 bytes, not JavaScript characters', () => {
    // six characters either way, but three bytes each rather than one
    const cjk = '走った毎日凛';
    const ascii = 'abcdef';
    expect(cjk).toHaveLength(ascii.length);
    expect(ciphertextChars(cjk)).toBeGreaterThan(ciphertextChars(ascii));

    // an emoji is two characters and four bytes
    const emoji = '🏃🏃';
    expect(emoji).toHaveLength('abcd'.length);
    expect(ciphertextChars(emoji)).toBeGreaterThan(ciphertextChars('abcd'));
  });

  it.each([
    ['nothing', ''],
    ['one character', 'a'],
    ['two characters', 'ab'],
    ['three characters', 'abc'],
    ['a real month', JSON.stringify({ habits: [{ id: '0', name: 'Run' }], grid: { '1:0': 1 } })],
    ['text that is not ASCII', JSON.stringify({ observations: ['凛 — 走った 🏃'] })],
    ['a month sitting exactly on the limit', 'a'.repeat(49136)],
  ])('agrees with what sealing %s actually produces', (_, plaintext) => {
    expect(ciphertextChars(plaintext)).toBe(seal(key, plaintext).ct.length);
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
    const flipped = Buffer.from(record.ct, 'base64');
    flipped[0] ^= 1;
    expect(open(key, { ...record, ct: base64(flipped) })).toBeNull();
  });

  it('refuses a swapped nonce', () => {
    expect(open(key, { ...record, iv: base64(new Uint8Array(24).fill(1)) })).toBeNull();
  });

  it.each([
    ['a newer format version', { v: 2 }],
    ['a nonce of the wrong length', { iv: base64(new Uint8Array(12)) }],
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
  const key = deriveKey(CODE);

  it('round-trips every byte value at every alignment', () => {
    for (let length = 0; length < 5; length++) {
      mockNextRandom = new Uint8Array(24).map((_, i) => (i * 37 + length) & 255);
      const record = seal(key, 'a'.repeat(length));
      // standard base64, exactly as Node writes it, and read back by `open`
      expect(base64(Buffer.from(record.iv, 'base64'))).toBe(record.iv);
      expect(base64(Buffer.from(record.ct, 'base64'))).toBe(record.ct);
      expect(open(key, record)).toBe('a'.repeat(length));
    }
    mockNextRandom = new Uint8Array(24).map((_, i) => 232 + i);
    expect(seal(key, '').iv).toBe(base64(new Uint8Array(24).map((_, i) => 232 + i)));
  });

  it('rejects what is not base64', () => {
    const record = seal(key, 'x');
    expect(open(key, { ...record, iv: 'a' })).toBeNull();
    expect(open(key, { ...record, ct: '****' })).toBeNull();
  });
});
