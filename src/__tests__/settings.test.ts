import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSettings } from '../settings';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const store = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const DEFAULTS = { theme: 'dark', chart: 'radial' };

describe('loadSettings', () => {
  it('falls back to the defaults when nothing is stored', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(loadSettings()).resolves.toEqual(DEFAULTS);
  });

  it('only accepts values it knows, one field at a time', async () => {
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 'sepia', chart: 'github' }));
    await expect(loadSettings()).resolves.toEqual({ theme: 'dark', chart: 'github' });
  });

  it('survives unreadable JSON', async () => {
    store.getItem.mockResolvedValue('{nope');
    await expect(loadSettings()).resolves.toEqual(DEFAULTS);
  });

  it('survives storage itself failing', async () => {
    store.getItem.mockRejectedValue(new Error('disk'));
    await expect(loadSettings()).resolves.toEqual(DEFAULTS);
  });
});
