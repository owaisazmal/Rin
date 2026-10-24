import * as SecureStore from 'expo-secure-store';

// Keychain / Keystore storage, split across entries to stay under SecureStore's 2 KB ceiling.

const PREFIX = 'monthly-planning.session';

// characters per entry, inside the ceiling even if every one were three bytes
export const CHUNK_SIZE = 1024;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// SecureStore keys may only hold alphanumerics, `.`, `-` and `_`
function namespace(key: string): string {
  return `${PREFIX}.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

const countKey = (key: string) => `${namespace(key)}.n`;
const chunkKey = (key: string, i: number) => `${namespace(key)}.${i}`;

async function chunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  const n = raw === null ? 0 : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// never cuts through a surrogate pair, which would not survive the native round trip
function split(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < value.length || parts.length === 0) {
    let end = Math.min(start + CHUNK_SIZE, value.length);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
    parts.push(value.slice(start, end));
    start = end;
  }
  return parts;
}

async function deleteChunks(key: string, from: number, to: number): Promise<void> {
  for (let i = from; i < to; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
  }
}

// Best-effort, and not atomic across pieces: don't write one key concurrently.
export const sessionStorage = {
  // null when absent or not readable back whole
  async getItem(key: string): Promise<string | null> {
    try {
      const n = await chunkCount(key);
      if (n === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTIONS);
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    } catch {
      return null;
    }
  },

  // pieces first, count last, then whatever the previous value left past the new end
  async setItem(key: string, value: string): Promise<void> {
    try {
      const previous = await chunkCount(key);
      const parts = split(value);
      for (let i = 0; i < parts.length; i++) {
        await SecureStore.setItemAsync(chunkKey(key, i), parts[i], OPTIONS);
      }
      await SecureStore.setItemAsync(countKey(key), String(parts.length), OPTIONS);
      await deleteChunks(key, parts.length, previous);
    } catch {
      // a code that fails to persist is simply absent next launch
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      const n = await chunkCount(key);
      await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
      await deleteChunks(key, 0, n);
    } catch {
      // already gone
    }
  },
};
