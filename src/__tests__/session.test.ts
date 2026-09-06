import * as SecureStore from 'expo-secure-store';
import { CHUNK_SIZE, sessionStorage } from '../session';

/**
 * SecureStore minus the keychain: a map, plus the one rule the real module
 * enforces on keys. Everything worth testing is whether a value survives the
 * trip through the size ceiling and comes back whole — or not at all.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  const check = (key: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) {
      throw new Error(`Invalid key provided to SecureStore: ${key}`);
    }
  };
  return {
    __esModule: true,
    __store: store,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (key: string) => {
      check(key);
      return store.get(key) ?? null;
    }),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      check(key);
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      check(key);
      store.delete(key);
    }),
  };
});

const keychain = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = 'backup-code';

const chunkEntries = () => [...keychain.entries()].filter(([k]) => !k.endsWith('.n'));

beforeEach(() => keychain.clear());

describe('sessionStorage', () => {
  it('returns null for a key that was never written', async () => {
    await expect(sessionStorage.getItem(KEY)).resolves.toBeNull();
  });

  it('round-trips a short value in a single entry', async () => {
    await sessionStorage.setItem(KEY, 'eyJhbGciOi.short.jwt');
    await expect(sessionStorage.getItem(KEY)).resolves.toBe('eyJhbGciOi.short.jwt');
    expect(chunkEntries()).toHaveLength(1);
  });

  it('splits a value larger than one entry allows and reassembles it', async () => {
    // several times larger than one entry allows
    const blob = JSON.stringify({ code: 'a'.repeat(2400), salt: 'r'.repeat(64) });
    await sessionStorage.setItem(KEY, blob);

    const chunks = chunkEntries();
    expect(chunks).toHaveLength(Math.ceil(blob.length / CHUNK_SIZE));
    for (const [, v] of chunks) expect(v.length).toBeLessThanOrEqual(CHUNK_SIZE);
    await expect(sessionStorage.getItem(KEY)).resolves.toBe(blob);
  });

  it('round-trips an empty string as a value, not as absence', async () => {
    await sessionStorage.setItem(KEY, '');
    await expect(sessionStorage.getItem(KEY)).resolves.toBe('');
  });

  it('leaves no stale entries behind when a shorter value replaces a longer one', async () => {
    await sessionStorage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * 3));
    await sessionStorage.setItem(KEY, 'short');
    await expect(sessionStorage.getItem(KEY)).resolves.toBe('short');
    expect(keychain.size).toBe(2); // one piece plus the count
  });

  it('removes every entry', async () => {
    await sessionStorage.setItem(KEY, 'y'.repeat(CHUNK_SIZE * 2 + 1));
    await sessionStorage.removeItem(KEY);
    expect(keychain.size).toBe(0);
    await expect(sessionStorage.getItem(KEY)).resolves.toBeNull();
  });

  it('treats a value with a missing piece as absent rather than returning a fragment', async () => {
    await sessionStorage.setItem(KEY, 'z'.repeat(CHUNK_SIZE * 2));
    const [middle] = [...keychain.keys()].filter((k) => k.endsWith('.1'));
    keychain.delete(middle);
    await expect(sessionStorage.getItem(KEY)).resolves.toBeNull();
  });

  it('accepts the keys the clients actually use', async () => {
    // Firebase's has colons and brackets in it, which SecureStore rejects outright
    const firebaseKey = 'firebase:authUser:AIzaSyExample:[DEFAULT]';
    await sessionStorage.setItem(firebaseKey, '{"uid":"u"}');
    await expect(sessionStorage.getItem(firebaseKey)).resolves.toBe('{"uid":"u"}');
    for (const k of keychain.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('keeps two keys apart', async () => {
    await sessionStorage.setItem('a', '1');
    await sessionStorage.setItem('b', '2');
    await sessionStorage.removeItem('a');
    await expect(sessionStorage.getItem('a')).resolves.toBeNull();
    await expect(sessionStorage.getItem('b')).resolves.toBe('2');
  });

  it('does not cut an emoji in half at a piece boundary', async () => {
    // put an astral character exactly on the seam
    const value = 'n'.repeat(CHUNK_SIZE - 1) + '😀' + 'tail';
    await sessionStorage.setItem(KEY, value);
    for (const [, v] of chunkEntries()) {
      expect(v).not.toMatch(/^[\uDC00-\uDFFF]/);
      expect(v).not.toMatch(/[\uD800-\uDBFF]$/);
    }
    await expect(sessionStorage.getItem(KEY)).resolves.toBe(value);
  });

  it('never throws at the caller when the keychain does', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
    await expect(sessionStorage.setItem(KEY, 'v')).resolves.toBeUndefined();

    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
    await expect(sessionStorage.getItem(KEY)).resolves.toBeNull();

    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
    await expect(sessionStorage.removeItem(KEY)).resolves.toBeUndefined();
  });
});
