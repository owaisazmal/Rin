import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultLayout } from '../layout';
import { loadSettings, resolveTheme } from '../settings';

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

  it('keeps a stored system preference rather than turning it into dark', async () => {
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 'system', chart: 'radial' }));
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULTS, theme: 'system' });
  });

  it('leaves settings saved before System existed on the theme they chose', async () => {
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 'dark', chart: 'radial' }));
    await expect(loadSettings()).resolves.toEqual(DEFAULTS);
  });

  it('falls back to dark for a theme that is missing or not a string', async () => {
    store.getItem.mockResolvedValue(JSON.stringify({ chart: 'github' }));
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULTS, chart: 'github' });
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 1, chart: 'github' }));
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULTS, chart: 'github' });
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

describe('resolveTheme', () => {
  it('draws a chosen theme whatever the OS says', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
  });

  it('follows the OS on system', () => {
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', 'dark')).toBe('dark');
  });

  it('falls back to dark on system when the OS gives no answer', () => {
    expect(resolveTheme('system', null)).toBe('dark');
    expect(resolveTheme('system', undefined)).toBe('dark');
    expect(resolveTheme('system', 'unspecified')).toBe('dark');
  });
});
