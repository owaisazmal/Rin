import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultLayout } from '../layout';
import { loadSettings } from '../settings';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const store = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const DEFAULTS = { theme: 'dark', chart: 'radial', layout: defaultLayout() };

describe('loadSettings', () => {
  it('falls back to the defaults when nothing is stored', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(loadSettings()).resolves.toEqual(DEFAULTS);
  });

  it('only accepts values it knows, one field at a time', async () => {
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 'sepia', chart: 'github' }));
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULTS, chart: 'github' });
  });

  it('gives settings saved before the cards could be arranged the layout they always had', async () => {
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 'light', chart: 'github' }));
    await expect(loadSettings()).resolves.toEqual({
      theme: 'light',
      chart: 'github',
      layout: defaultLayout(),
    });
  });

  it('reads a stored layout back, hidden cards and custom ones included', async () => {
    const layout = {
      slots: [
        { id: 'quote', shown: false },
        { id: 'c-ideas', shown: true, custom: { title: 'Ideas', kind: 'list' } },
        { id: 'deadlines', shown: true },
        { id: 'goals', shown: true },
        { id: 'observations', shown: false },
      ],
      removed: ['c-gone'],
    };
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 'dark', chart: 'radial', layout }));
    await expect(loadSettings()).resolves.toEqual({ theme: 'dark', chart: 'radial', layout });
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
