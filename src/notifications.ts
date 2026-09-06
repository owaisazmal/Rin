import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CellState, Habit, cellKey } from './types';
import { Task } from './tasks';
import { dueLabel, pendingTasks } from './deadlines';
import { DAY, HOUR } from './dates';

/**
 * Daily nudges for habits you haven't ticked off yet.
 *
 * iOS delivers local notifications from a schedule fixed in advance — nothing
 * runs at delivery time to ask "did they do it?". So instead the app rewrites
 * the whole schedule every time the data changes: today's remaining nudges are
 * dropped the moment nothing is left pending, and a week of them is queued ahead
 * so reminders still arrive if the app is never opened.
 */

/** Times of day to nudge, as [hour, minute]. */
const SLOTS: [number, number][] = [
  [12, 30],
  [17, 30],
  [20, 45],
];

/** How many days of nudges to keep queued, so silence never means "app unopened". */
const DAYS_AHEAD = 7;

const TITLES = ['Still pending', 'Evening check', 'Last call'];

/** One voice per slot: nudge at midday, firmer by evening, cheerfully doomed at night. */
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

/**
 * The run-up to a deadline, and what to say at each point.
 *
 * Getting louder as the date approaches is the whole feature, so the spacing
 * tightens rather than staying even: three days, then one, then hours. Anything
 * further out than three days is left alone — a reminder a fortnight ahead
 * teaches you to swipe reminders away.
 */
const LEADS: { before: number; line: string }[] = [
  { before: 3 * DAY, line: 'Three days out. Comfortable. Enjoy that while it lasts.' },
  { before: DAY, line: 'One day left. This is the part where it stops being theoretical.' },
  { before: 3 * HOUR, line: 'Three hours. No longer a tomorrow problem.' },
  { before: HOUR, line: 'One hour. Whatever the plan was, this is it.' },
  { before: 0, line: 'Deadline reached. How did that go?' },
];

const OVERDUE_LINE =
  'Past due. It will not finish itself, and it is not going anywhere either.';

/** Morning-after hour for the one nag an already-missed deadline gets */
const OVERDUE_HOUR = 9;

/**
 * How many notifications the deadline reminders may claim.
 *
 * iOS keeps only the 64 soonest pending local notifications and silently drops
 * everything past that, and the habit nudges above already hold up to 22. This
 * cap stops a long task list from quietly evicting them — whatever else is on,
 * a full week of habit reminders still fits.
 */
const DEADLINE_BUDGET = 28;

/** Never let one very distant task spend the whole allowance on itself */
const MAX_PER_TASK = 5;

function titleFor(task: Task): string {
  const text = task.text.trim();
  if (!text) return 'Untitled task';
  return text.length > 44 ? `${text.slice(0, 43)}…` : text;
}

/**
 * Queues the run-up for every task with a deadline still ahead of it, soonest
 * first, until the allowance runs out. Returns nothing — like the rest of this
 * module it is best-effort, and a task that doesn't fit simply gets its
 * reminders on the next sync, once the ones ahead of it have fired.
 */
async function scheduleDeadlines(tasks: Task[], now: Date): Promise<void> {
  const nowMs = now.getTime();
  let budget = DEADLINE_BUDGET;

  for (const task of pendingTasks(tasks)) {
    if (budget <= 0) return;

    // Already missed: one nag the next morning, not a replay of the run-up.
    if (task.due <= nowMs) {
      const at = new Date(now);
      at.setHours(OVERDUE_HOUR, 0, 0, 0);
      if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
      await Notifications.scheduleNotificationAsync({
        content: { title: titleFor(task), body: `${dueLabel(task.due, at.getTime())}. ${OVERDUE_LINE}` },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: DEADLINE_CHANNEL,
        },
      });
      budget--;
      continue;
    }

    let used = 0;
    for (const lead of LEADS) {
      if (budget <= 0 || used >= MAX_PER_TASK) break;
      const at = new Date(task.due - lead.before);
      if (at.getTime() <= nowMs) continue; // that moment has already gone by
      await Notifications.scheduleNotificationAsync({
        content: {
          title: titleFor(task),
          body: `Due ${dueLabel(task.due, at.getTime())}. ${lead.line}`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: DEADLINE_CHANNEL,
        },
      });
      budget--;
      used++;
    }
  }
}

async function ensurePermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(HABIT_CHANNEL, {
        name: 'Habit reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      // Its own channel, and a louder one: a deadline is a thing with a
      // consequence, and Android lets someone mute the daily nagging without
      // also muting the reminder that something is due in an hour.
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

function pendingCount(habits: Habit[], grid: Record<string, CellState>, day: number): number {
  return habits.filter((h) => (grid[cellKey(day, h.id)] ?? 0) === 0).length;
}

function bodyFor(slot: number, dayOffset: number, pending: number): string {
  const lines = LINES[slot];
  // vary by day so the same line doesn't land two days running
  const line = lines[(dayOffset + slot) % lines.length];
  if (dayOffset === 0 && pending > 0) {
    const noun = pending === 1 ? 'habit' : 'habits';
    return `${pending} ${noun} still unticked. ${line}`;
  }
  return line;
}

export async function syncReminders(opts: {
  habits: Habit[];
  grid: Record<string, CellState>;
  /** current day-of-month, or null when the open month isn't the live one */
  today: number | null;
  /** tasks with deadlines — not month-scoped, so they survive browsing */
  tasks: Task[];
  now: Date;
}): Promise<void> {
  const { habits, grid, today, tasks, now } = opts;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    // Nothing to say at all — don't provoke the permission prompt for it.
    if (habits.length === 0 && pendingTasks(tasks).length === 0) return;
    if (!(await ensurePermission())) return;

    await scheduleDeadlines(tasks, now);
    if (habits.length === 0) return;

    // Only the live month tells us anything about what's pending right now.
    const pendingToday = today !== null ? pendingCount(habits, grid, today) : habits.length;

    // Day already finished: swap the remaining nags for a single well-done.
    if (today !== null && pendingToday === 0) {
      const nextSlot = SLOTS.map(([hour, minute]) => {
        const at = new Date(now);
        at.setHours(hour, minute, 0, 0);
        return at;
      }).find((at) => at.getTime() > now.getTime());

      if (nextSlot) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'All done today',
            body: CONGRATS[today % CONGRATS.length],
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: nextSlot,
            channelId: HABIT_CHANNEL,
          },
        });
      }
    }

    for (let dayOffset = 0; dayOffset < DAYS_AHEAD; dayOffset++) {
      // nothing left to nag about today — skip straight to tomorrow
      if (dayOffset === 0 && pendingToday === 0) continue;

      for (let slot = 0; slot < SLOTS.length; slot++) {
        const [hour, minute] = SLOTS[slot];
        const when = new Date(now);
        when.setDate(when.getDate() + dayOffset);
        when.setHours(hour, minute, 0, 0);
        if (when.getTime() <= now.getTime()) continue; // already passed today

        await Notifications.scheduleNotificationAsync({
          content: {
            title: TITLES[slot],
            body: bodyFor(slot, dayOffset, pendingToday),
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: when,
            channelId: HABIT_CHANNEL,
          },
        });
      }
    }
  } catch {
    // reminders are a nicety; never let scheduling failure surface in the app
  }
}
