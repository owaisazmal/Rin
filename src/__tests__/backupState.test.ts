import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  emptyBackupState,
  forgetCode,
  loadBackupState,
  loadCode,
  saveBackupState,
  saveCode,
} from '../backupState';

/**
 * Two stores, deliberately kept apart: the code goes to the Keychain, and the
 * unremarkable part — has it been answered, when did it last run — goes beside
 * the habit grids. What matters here is that the code never crosses into the
 * second one.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

jest.mock('expo-secure-store', () => {
  const keychain = new Map<string, string>();
  return {
    __esModule: true,
    __keychain: keychain,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (k: string) => keychain.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      keychain.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      keychain.delete(k);
    }),
  };
});

const local = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const keychain = (require('expo-secure-store') as { __keychain: Map<string, string> }).__keychain;

const CODE = 'K7Q2-9XBM-4TRV-8NPZ-3HGD-6WYS';

beforeEach(() => keychain.clear());

describe('the code', () => {
  it('round-trips through the keychain', async () => {
    await saveCode(CODE);
    await expect(loadCode()).resolves.toBe(CODE);
  });

  it('is null on a phone that has never made one', async () => {
    await expect(loadCode()).resolves.toBeNull();
  });

  it('never reaches AsyncStorage', async () => {
    await saveCode(CODE);
    const written = local.setItem.mock.calls.map(([, v]) => v).join('');
    expect(written).not.toContain(CODE);
    expect([...keychain.values()].join('')).toContain(CODE);
  });

  it('is gone once forgotten', async () => {
    await saveCode(CODE);
    await forgetCode();
    await expect(loadCode()).resolves.toBeNull();
    expect(keychain.size).toBe(0);
  });
});

describe('the rest of the state', () => {
  it('reads back what was written', async () => {
    await saveBackupState({ onboarded: true, lastBackupAt: 1_800_000_000_000 });
    const [, written] = local.setItem.mock.calls[0];
    local.getItem.mockResolvedValue(written);
    await expect(loadBackupState()).resolves.toEqual({
      onboarded: true,
      lastBackupAt: 1_800_000_000_000,
    });
  });

  it('starts empty', async () => {
    local.getItem.mockResolvedValue(null);
    await expect(loadBackupState()).resolves.toEqual(emptyBackupState);
  });

  it.each([
    ['broken JSON', '{not json'],
    ['a string', '"nope"'],
    ['a timestamp that is not a number', '{"onboarded":true,"lastBackupAt":"today"}'],
    ['a timestamp that is not finite', '{"onboarded":true,"lastBackupAt":null}'],
  ])('survives %s', async (_, stored) => {
    local.getItem.mockResolvedValue(stored);
    const state = await loadBackupState();
    expect(state.lastBackupAt).toBeNull();
    expect(typeof state.onboarded).toBe('boolean');
  });

  it('does not crash when storage itself fails', async () => {
    local.getItem.mockRejectedValue(new Error('disk'));
    await expect(loadBackupState()).resolves.toEqual(emptyBackupState);
    local.setItem.mockRejectedValue(new Error('disk'));
    await expect(saveBackupState(emptyBackupState)).resolves.toBeUndefined();
  });
});
