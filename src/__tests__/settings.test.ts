import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultLayout } from '../layout';
import {
  MAX_SLOTS,
  defaultNotifications,
  loadSettings,
  parseNotifications,
  placeSlot,
  resolveTheme,
} from '../settings';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const store = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const DEFAULTS = {
  theme: 'dark',
  chart: 'radial',
  layout: defaultLayout(),
  notifications: defaultNotifications(),
};

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
      ...DEFAULTS,
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
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULTS, layout });
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

describe('notification settings', () => {
  it('default to the schedule the app always had', () => {
    expect(defaultNotifications()).toEqual({
      habits: true,
      slots: [
        { on: true, hour: 12, minute: 30 },
        { on: true, hour: 17, minute: 30 },
        { on: true, hour: 20, minute: 45 },
      ],
      allDone: true,
      deadlines: true,
      leads: { '3d': true, '1d': true, '3h': true, '1h': true, due: true },
    });
  });

  it('give settings saved before they existed the defaults', async () => {
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 'light', chart: 'radial' }));
    const loaded = await loadSettings();
    expect(loaded.notifications).toEqual(defaultNotifications());
  });

  it('read stored choices back through loadSettings', async () => {
    const notifications = {
      habits: false,
      slots: [{ on: false, hour: 7, minute: 5 }],
      allDone: false,
      deadlines: true,
      leads: { '3d': false, '1d': true, '3h': false, '1h': true, due: false },
    };
    store.getItem.mockResolvedValue(JSON.stringify({ theme: 'dark', notifications }));
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULTS, notifications });
  });

  it('fall back one field at a time', () => {
    expect(
      parseNotifications({ habits: 'no', allDone: false, deadlines: 0, leads: { '1h': false, x: true } })
    ).toEqual({
      ...defaultNotifications(),
      allDone: false,
      leads: { '3d': true, '1d': true, '3h': true, '1h': false, due: true },
    });
    expect(parseNotifications(null)).toEqual(defaultNotifications());
    expect(parseNotifications('on')).toEqual(defaultNotifications());
  });

  it('drop slots with impossible times, and keep the defaults when none survive', () => {
    expect(
      parseNotifications({
        slots: [{ hour: 24, minute: 0 }, { hour: 8, minute: 60 }, { hour: 6.5, minute: 0 }, { hour: 6, minute: 15 }],
      }).slots
    ).toEqual([{ on: true, hour: 6, minute: 15 }]);
    expect(parseNotifications({ slots: [{ hour: -1, minute: 0 }] }).slots).toEqual(defaultNotifications().slots);
    expect(parseNotifications({ slots: [] }).slots).toEqual(defaultNotifications().slots);
    expect(parseNotifications({ slots: 'noon' }).slots).toEqual(defaultNotifications().slots);
  });

  it('cap the number of slots', () => {
    const slots = Array.from({ length: 9 }, (_, i) => ({ on: true, hour: 8 + i, minute: 0 }));
    expect(parseNotifications({ slots }).slots).toHaveLength(MAX_SLOTS);
  });
});

describe('placeSlot', () => {
  const slots = defaultNotifications().slots;

  it('adds a slot in time order, switched on', () => {
    expect(placeSlot(slots, null, 9, 0).map((s) => [s.hour, s.minute, s.on])).toEqual([
      [9, 0, true],
      [12, 30, true],
      [17, 30, true],
      [20, 45, true],
    ]);
  });

  it('moves a slot and keeps it in order, on or off as it was', () => {
    const off = slots.map((s, i) => (i === 0 ? { ...s, on: false } : s));
    expect(placeSlot(off, 0, 22, 0)).toEqual([
      { on: true, hour: 17, minute: 30 },
      { on: true, hour: 20, minute: 45 },
      { on: false, hour: 22, minute: 0 },
    ]);
  });

  it('never makes two slots at the same time', () => {
    const off = slots.map((s, i) => (i === 1 ? { ...s, on: false } : s));
    expect(placeSlot(off, null, 17, 30)).toEqual(slots);
    expect(placeSlot(slots, 0, 20, 45)).toEqual([
      { on: true, hour: 17, minute: 30 },
      { on: true, hour: 20, minute: 45 },
    ]);
  });

  it('adds nothing past the cap', () => {
    const full = Array.from({ length: MAX_SLOTS }, (_, i) => ({ on: true, hour: 8 + i, minute: 0 }));
    expect(placeSlot(full, null, 22, 0)).toBe(full);
  });
});
