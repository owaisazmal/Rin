import * as SecureStore from 'expo-secure-store';

/**
 * Where the auth session lives.
 *
 * Deliberately not AsyncStorage. AsyncStorage is plaintext on disk — a SQLite
 * row on Android, a file in the app container on iOS — readable from any debug
 * build with `adb run-as`, and from any release build on a rooted or
 * jailbroken device. That is fine for habit grids and fine for the name and
 * email in `auth.ts`; it is not fine for a credential that grants access to an
 * account.
 *
 * SecureStore puts the value in the iOS Keychain and the Android Keystore
 * instead, so it is encrypted at rest and tied to this app. `THIS_DEVICE_ONLY`
 * keeps it out of backups too: a restored phone starts signed out.
 *
 * What goes here is the backup code: the one secret in the design, from which
 * both the id a backup is stored under and the key it is encrypted with are
 * derived (see firestore.rules for the other half). There are no accounts, so
 * there is no session token to keep — but the shape exposed is the
 * getItem / setItem / removeItem adapter Firebase's persistence accepts, in
 * case one is ever wanted, and values are split across entries to stay under
 * SecureStore's documented 2 KB ceiling, in case one is ever that large. A
 * code never is; the seams cost nothing when there is only one piece. Writes
 * are not atomic across pieces, so don't write the same key concurrently.
 *
 * Nothing calls this yet — there is no backend. Needs a native rebuild before
 * first use, since SecureStore ships native code.
 */

const PREFIX = 'monthly-planning.session';

/**
 * Characters per entry. Comfortably inside the documented ceiling even if
 * every character were a three-byte one — which, in a session blob, none of
 * them are outside the user's display name.
 */
export const CHUNK_SIZE = 1024;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * SecureStore keys may only contain alphanumerics, `.`, `-` and `_`. The keys
 * clients choose don't oblige (Firebase's has colons in it), so anything else
 * becomes an underscore. The prefix keeps them out of anyone else's way.
 */
function namespace(key: string): string {
  return `${PREFIX}.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

const countKey = (key: string) => `${namespace(key)}.n`;
const chunkKey = (key: string, i: number) => `${namespace(key)}.${i}`;

/** How many entries the value under `key` was last written as; 0 if none */
async function chunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  const n = raw === null ? 0 : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Cuts on character boundaries, never through a surrogate pair — half an
 * emoji would not survive the round trip through a native string.
 */
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

/** The getItem / setItem / removeItem shape Firebase's persistence accepts */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const sessionStorage: SessionStorage = {
  /**
   * The stored value, or null if there isn't one or it can't be read back
   * whole — a corrupt session should sign the user out, not crash the app.
   */
  async getItem(key) {
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

  /**
   * Pieces first, count last, then whatever the previous value left behind
   * past the new end. Best-effort, like the rest of the app's stores: a
   * session that fails to persist signs the user out on the next launch
   * rather than crashing this one.
   */
  async setItem(key, value) {
    try {
      const previous = await chunkCount(key);
      const parts = split(value);
      for (let i = 0; i < parts.length; i++) {
        await SecureStore.setItemAsync(chunkKey(key, i), parts[i], OPTIONS);
      }
      await SecureStore.setItemAsync(countKey(key), String(parts.length), OPTIONS);
      await deleteChunks(key, parts.length, previous);
    } catch {
      // see above
    }
  },

  async removeItem(key) {
    try {
      const n = await chunkCount(key);
      await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
      await deleteChunks(key, 0, n);
    } catch {
      // already gone
    }
  },
};

/** Whether SecureStore is usable — false on web, where there's no keystore */
export function isAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync();
}
