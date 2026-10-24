import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CellState, Habit, cellKey } from './types';
import { Task } from './tasks';
import { dueLabel, pendingTasks } from './deadlines';
import { DAY, HOUR } from './dates';
import { DeadlineLead, NotificationPrefs, ReminderSlot } from './settings';

// Nothing runs at delivery time, so the whole schedule is rewritten on every change, a week ahead.
const DAYS_AHEAD = 7;

const TITLES = ['Still pending', 'Evening check', 'Last call'];

/** Where each voice starts, in minutes past midnight; the default 12:30, 17:30 and 20:45 get one each */
const VOICE_FROM = [0, 17 * 60, 20 * 60];

/** One voice per time of day: nudge at midday, firmer by evening, cheerfully doomed at night. */
const LINES: string[][] = [
  [
    "Your habits are sitting there untouched. They have feelings, you know.",
    "Two taps. That's the whole commitment. You've done harder before breakfast.",
    "Nothing ticked yet. The chart is looking a bit beige.",
    "Checking in. No pressure. Slight pressure.",
  ],
  [
    "Future you just opened the app. Future you is not thrilled.",
    "The grid has a hole in it and it's shaped exactly like today.",
    "Your habits have filed a missing person report.",
    "Still time to make today count. Comfortably. For now.",
  ],
  [
    "That streak took weeks to build and about one evening to lose.",
    "Discipline called. Left a voicemail. This is the voicemail.",
    "You don't have to feel like it. You just have to tap the thing.",
    "Last call. The day is closing its tab.",
  ],
];

/** Sent once when the day is fully accounted for, instead of another nudge. */
const CONGRATS = [
  "All ticked. Today didn't stand a chance.",
  'Clean sweep. Streak intact, smugness earned.',
  'Everything done. The grid is green and so are you.',
  'Done and dusted. Go and be insufferable about it.',
];

const HABIT_CHANNEL = 'reminders';
const DEADLINE_CHANNEL = 'deadlines';

/** The run-up to a deadline, tightening as it nears; nothing further out than three days */
const LEADS: { id: DeadlineLead; before: number; line: string }[] = [
  { id: '3d', before: 3 * DAY, line: 'Three days out. Comfortable. Enjoy that while it lasts.' },
  { id: '1d', before: DAY, line: 'One day left. This is the part where it stops being theoretical.' },
  { id: '3h', before: 3 * HOUR, line: 'Three hours. No longer a tomorrow problem.' },
  { id: '1h', before: HOUR, line: 'One hour. Whatever the plan was, this is it.' },
  { id: 'due', before: 0, line: 'Deadline reached. How did that go?' },
];

const OVERDUE_LINE =
  'Past due. It will not finish itself, and it is not going anywhere either.';

/** Morning-after hour for the one nag an already-missed deadline gets */
const OVERDUE_HOUR = 9;

/** iOS keeps only the 64 soonest notifications; this leaves room for a full week of habit nudges */
const DEADLINE_BUDGET = 28;

/** Never let one very distant task spend the whole allowance on itself */
const MAX_PER_TASK = 5;

function titleFor(task: Task): string {
  const text = task.text.trim();
  if (!text) return 'Untitled task';
  return text.length > 44 ? `${text.slice(0, 43)}…` : text;
}

/** One notification to queue */
export interface Planned {
  title: string;
  body: string;
  date: Date;
  channelId: string;
}

/** Soonest first until the budget runs out; a task that doesn't fit is picked up on a later sync */
function planDeadlines(
  tasks: Task[],
  now: Date,
  leads: Record<DeadlineLead, boolean>,
  overdue: boolean
): Planned[] {
  const nowMs = now.getTime();
  const planned: Planned[] = [];
  const run = LEADS.filter((lead) => leads[lead.id]);

  for (const task of pendingTasks(tasks)) {
    if (planned.length >= DEADLINE_BUDGET) break;

    // Already missed: one nag the next morning, not a replay of the run-up.
    if (task.due <= nowMs) {
      if (!overdue) continue;
      const at = new Date(now);
      at.setHours(OVERDUE_HOUR, 0, 0, 0);
      if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
      planned.push({
        title: titleFor(task),
        body: `${dueLabel(task.due, at.getTime())}. ${OVERDUE_LINE}`,
        date: at,
        channelId: DEADLINE_CHANNEL,
      });
      continue;
    }

    let used = 0;
    for (const lead of run) {
      if (planned.length >= DEADLINE_BUDGET || used >= MAX_PER_TASK) break;
      const at = new Date(task.due - lead.before);
      if (at.getTime() <= nowMs) continue; // that moment has already gone by
      planned.push({
        title: titleFor(task),
        body: `Due ${dueLabel(task.due, at.getTime())}. ${lead.line}`,
        date: at,
        channelId: DEADLINE_CHANNEL,
      });
      used++;
    }
  }
  return planned;
}

async function ensurePermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(HABIT_CHANNEL, {
        name: 'Habit reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      // louder, and separate so the habit nagging can be muted on its own
      await Notifications.setNotificationChannelAsync(DEADLINE_CHANNEL, {
        name: 'Deadlines',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

/** True once the OS has refused and won't let the app ask again */
export async function notificationsBlocked(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    return !current.granted && !current.canAskAgain;
  } catch {
    return false;
  }
}

function pendingCount(habits: Habit[], grid: Record<string, CellState>, day: number): number {
  return habits.filter((h) => (grid[cellKey(day, h.id)] ?? 0) === 0).length;
}

function voiceAt(minutes: number): number {
  return VOICE_FROM.filter((from) => minutes >= from).length - 1;
}

function bodyFor(voice: number, position: number, dayOffset: number, pending: number): string {
  const lines = LINES[voice];
  // vary by day so the same line doesn't land two days running
  const line = lines[(dayOffset + position) % lines.length];
  if (dayOffset === 0 && pending > 0) {
    const noun = pending === 1 ? 'habit' : 'habits';
    return `${pending} ${noun} still unticked. ${line}`;
  }
  return line;
}

/** The switched-on slots in the order they ring, one per distinct time */
function ringTimes(slots: ReminderSlot[]): ReminderSlot[] {
  const byMinute = new Map<number, ReminderSlot>();
  for (const s of slots) if (s.on) byMinute.set(s.hour * 60 + s.minute, s);
  return [...byMinute.entries()].sort(([a], [b]) => a - b).map(([, s]) => s);
}

interface ReminderInput {
  habits: Habit[];
  grid: Record<string, CellState>;
  /** current day-of-month, or null when the open month isn't the live one */
  today: number | null;
  /** tasks with deadlines — not month-scoped, so they survive browsing */
  tasks: Task[];
  now: Date;
  prefs: NotificationPrefs;
}

/** Everything the schedule should hold right now, deadlines first */
export function planReminders(opts: ReminderInput): Planned[] {
  const { habits, grid, today, tasks, now, prefs } = opts;
  const planned = prefs.deadlines ? planDeadlines(tasks, now, prefs.leads, prefs.overdue) : [];
  const times = prefs.habits ? ringTimes(prefs.slots) : [];
  if (habits.length === 0 || times.length === 0) return planned;

  // Only the live month tells us anything about what's pending right now.
  const pendingToday = today !== null ? pendingCount(habits, grid, today) : habits.length;

  // Day already finished: swap the remaining nags for a single well-done.
  if (prefs.allDone && today !== null && pendingToday === 0) {
    const nextSlot = times
      .map(({ hour, minute }) => {
        const at = new Date(now);
        at.setHours(hour, minute, 0, 0);
        return at;
      })
      .find((at) => at.getTime() > now.getTime());

    if (nextSlot) {
      planned.push({
        title: 'All done today',
        body: CONGRATS[today % CONGRATS.length],
        date: nextSlot,
        channelId: HABIT_CHANNEL,
      });
    }
  }

  for (let dayOffset = 0; dayOffset < DAYS_AHEAD; dayOffset++) {
    // nothing left to nag about today — skip straight to tomorrow
    if (dayOffset === 0 && pendingToday === 0) continue;

    times.forEach(({ hour, minute }, position) => {
      const when = new Date(now);
      when.setDate(when.getDate() + dayOffset);
      when.setHours(hour, minute, 0, 0);
      if (when.getTime() <= now.getTime()) return; // already passed today

      const voice = voiceAt(hour * 60 + minute);
      planned.push({
        title: TITLES[voice],
        body: bodyFor(voice, position, dayOffset, pendingToday),
        date: when,
        channelId: HABIT_CHANNEL,
      });
    });
  }
  return planned;
}

export async function syncReminders(opts: ReminderInput): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const planned = planReminders(opts);
    // Nothing to say at all — don't provoke the permission prompt for it.
    if (planned.length === 0) return;
    if (!(await ensurePermission())) return;

    for (const { title, body, date, channelId } of planned) {
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId },
      });
    }
  } catch {
    // reminders are a nicety; never let scheduling failure surface in the app
  }
}
