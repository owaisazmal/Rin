import * as Notifications from 'expo-notifications';
import { Planned, notificationsBlocked, planReminders, syncReminders } from '../notifications';
import { NotificationPrefs, ReminderSlot, defaultNotifications } from '../settings';
import { CellState, Habit, cellKey } from '../types';
import type { Task } from '../tasks';

jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));

const native = Notifications as jest.Mocked<typeof Notifications>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Tue 15 Sep 2026, 10:00 local, well away from daylight saving */
const NOW = new Date(2026, 8, 15, 10, 0);
const TODAY = 15;
const at = (dayOffset: number, hour: number, minute: number) =>
  new Date(2026, 8, TODAY + dayOffset, hour, minute).getTime();

const HABITS: Habit[] = [
  { id: '1', name: 'Read' },
  { id: '2', name: 'Run' },
];
const ALL_TICKED: Record<string, CellState> = {
  [cellKey(TODAY, '1')]: 1,
  [cellKey(TODAY, '2')]: 1,
};

function task(over: Partial<Task> = {}): Task {
  return { id: '0', text: 'Essay', due: NOW.getTime() + 4 * DAY, done: false, ...over };
}

const slot = (hour: number, minute: number, on = true): ReminderSlot => ({ on, hour, minute });

function plan(
  prefs: Partial<NotificationPrefs> = {},
  over: { grid?: Record<string, CellState>; tasks?: Task[]; now?: Date; habits?: Habit[] } = {}
): Planned[] {
  return planReminders({
    habits: over.habits ?? HABITS,
    grid: over.grid ?? {},
    today: TODAY,
    tasks: over.tasks ?? [],
    now: over.now ?? NOW,
    prefs: { ...defaultNotifications(), ...prefs },
  });
}

const habitsOf = (p: Planned[]) => p.filter((n) => n.channelId === 'reminders');
const deadlinesOf = (p: Planned[]) => p.filter((n) => n.channelId === 'deadlines');
const when = (p: Planned[]) => p.map((n) => [n.title, n.date.getTime()]);

describe('planReminders', () => {
  it('keeps the schedule the app always had by default', () => {
    const planned = plan({}, { tasks: [task()] });

    const expected = [];
    for (let d = 0; d < 7; d++) {
      expected.push(['Still pending', at(d, 12, 30)], ['Evening check', at(d, 17, 30)], ['Last call', at(d, 20, 45)]);
    }
    expect(when(habitsOf(planned))).toEqual(expected);
    expect(habitsOf(planned)[0].body).toBe(
      '2 habits still unticked. Your habits are sitting there untouched. They have feelings, you know.'
    );
    expect(habitsOf(planned)[4].body).toBe('Your habits have filed a missing person report.');

    const due = task().due;
    expect(deadlinesOf(planned).map((n) => n.date.getTime())).toEqual([
      due - 3 * DAY,
      due - DAY,
      due - 3 * HOUR,
      due - HOUR,
      due,
    ]);
  });

  it('rings only the switched-on slots, in time order', () => {
    const planned = habitsOf(plan({ slots: [slot(21, 0), slot(12, 30, false), slot(8, 15)] }));
    // 08:15 has already gone by today
    expect(when(planned.slice(0, 3))).toEqual([
      ['Last call', at(0, 21, 0)],
      ['Still pending', at(1, 8, 15)],
      ['Last call', at(1, 21, 0)],
    ]);
    expect(planned).toHaveLength(1 + 6 * 2);
  });

  it('gives each time of day its own voice', () => {
    const slots = [slot(7, 0), slot(13, 0), slot(17, 0), slot(19, 55), slot(20, 0)];
    const tomorrow = habitsOf(plan({ slots })).filter((n) => n.date.getTime() >= at(1, 0, 0)).slice(0, 5);
    expect(tomorrow.map((n) => n.title)).toEqual([
      'Still pending',
      'Still pending',
      'Evening check',
      'Evening check',
      'Last call',
    ]);
    // two slots sharing a voice still say different things
    expect(tomorrow[0].body).not.toBe(tomorrow[1].body);
    expect(tomorrow[2].body).not.toBe(tomorrow[3].body);
  });

  it('sends one reminder per distinct time', () => {
    const planned = habitsOf(plan({ slots: [slot(18, 0), slot(18, 0)] }));
    expect(planned).toHaveLength(7);
  });

  it('drops habit reminders when they are switched off, keeping deadlines', () => {
    const planned = plan({ habits: false }, { tasks: [task()] });
    expect(habitsOf(planned)).toHaveLength(0);
    expect(deadlinesOf(planned)).toHaveLength(5);
  });

  it('fires only the chosen lead times', () => {
    const leads = { '3d': false, '1d': true, '3h': false, '1h': false, due: true };
    const planned = plan({ leads }, { tasks: [task()] });
    const due = task().due;
    expect(deadlinesOf(planned).map((n) => n.date.getTime())).toEqual([due - DAY, due]);
    expect(deadlinesOf(planned)[0].body).toMatch(/One day left/);
  });

  it('still nags once about a missed deadline when every lead is off', () => {
    const leads = { '3d': false, '1d': false, '3h': false, '1h': false, due: false };
    const missed = task({ due: NOW.getTime() - HOUR });
    const planned = deadlinesOf(plan({ leads }, { tasks: [missed, task({ id: '1' })] }));
    expect(planned.map((n) => n.date.getTime())).toEqual([at(1, 9, 0)]);
  });

  it('drops the missed-deadline nudge on its own when that is switched off', () => {
    const missed = task({ due: NOW.getTime() - HOUR });
    const planned = deadlinesOf(plan({ overdue: false }, { tasks: [missed, task({ id: '1' })] }));
    expect(planned).toHaveLength(5);
    expect(planned.every((n) => !/Past due/.test(n.body))).toBe(true);
  });

  it('drops every deadline reminder, missed ones included, when switched off', () => {
    const tasks = [task(), task({ id: '1', due: NOW.getTime() - HOUR })];
    expect(deadlinesOf(plan({ deadlines: false }, { tasks }))).toHaveLength(0);
  });

  it('sends the all-done message at the next switched-on slot', () => {
    const planned = habitsOf(
      plan({ slots: [slot(12, 30, false), slot(17, 30), slot(20, 45)] }, { grid: ALL_TICKED })
    );
    expect(planned[0].title).toBe('All done today');
    expect(planned[0].date.getTime()).toBe(at(0, 17, 30));
    // and nothing else today
    expect(planned.slice(1).every((n) => n.date.getTime() >= at(1, 0, 0))).toBe(true);
  });

  it('leaves a finished day quiet when the all-done message is off', () => {
    const planned = habitsOf(plan({ allDone: false }, { grid: ALL_TICKED }));
    expect(planned.some((n) => n.title === 'All done today')).toBe(false);
    expect(planned[0].date.getTime()).toBe(at(1, 12, 30));
    expect(planned).toHaveLength(6 * 3);
  });

  it('stays inside the 64 iOS keeps with every slot on and a long task list', () => {
    const slots = [slot(9, 0), slot(12, 0), slot(15, 0), slot(18, 0), slot(21, 0)];
    const tasks = Array.from({ length: 30 }, (_, i) => task({ id: String(i), due: NOW.getTime() + (5 + i) * DAY }));
    const planned = plan({ slots }, { tasks, now: new Date(2026, 8, 15, 0, 1) });
    expect(habitsOf(planned)).toHaveLength(35);
    expect(planned.length).toBeLessThanOrEqual(64);
  });
});

describe('notificationsBlocked', () => {
  it('is true only once the OS has refused and will not ask again', async () => {
    native.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    await expect(notificationsBlocked()).resolves.toBe(true);
    native.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    await expect(notificationsBlocked()).resolves.toBe(false);
    native.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    await expect(notificationsBlocked()).resolves.toBe(false);
  });

  it('says nothing when the OS cannot be asked', async () => {
    native.getPermissionsAsync.mockRejectedValueOnce(new Error('no module'));
    await expect(notificationsBlocked()).resolves.toBe(false);
  });
});

describe('syncReminders', () => {
  const sync = (prefs: Partial<NotificationPrefs>, tasks: Task[] = [task()]) =>
    syncReminders({
      habits: HABITS,
      grid: {},
      today: TODAY,
      tasks,
      now: NOW,
      prefs: { ...defaultNotifications(), ...prefs },
    });

  it('never asks for permission when everything is off', async () => {
    await sync({ habits: false, deadlines: false });
    expect(native.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(native.getPermissionsAsync).not.toHaveBeenCalled();
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(native.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('never asks when what is switched on has nothing to send', async () => {
    await sync({ slots: [slot(12, 30, false)], deadlines: false });
    await sync({ slots: [slot(12, 30, false)] }, []);
    await sync({ habits: false, overdue: false }, [task({ due: NOW.getTime() - HOUR })]);
    expect(native.getPermissionsAsync).not.toHaveBeenCalled();
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks, then queues the planned schedule', async () => {
    await sync({ habits: false });
    expect(native.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(native.scheduleNotificationAsync).toHaveBeenCalledTimes(5);
    expect(native.scheduleNotificationAsync).toHaveBeenLastCalledWith({
      content: { title: 'Essay', body: expect.stringMatching(/Deadline reached/) },
      trigger: { type: 'date', date: new Date(task().due), channelId: 'deadlines' },
    });
  });
});
