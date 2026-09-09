/** 0 = empty, 1 = done (green), 2 = missed (red) */
export type CellState = 0 | 1 | 2;

export interface Habit {
  /** Stable id — grid keys reference this, so renames/reorders/removals never shift data */
  id: string;
  name: string;
}

export interface KeyGoal {
  text: string;
  done: boolean;
}

export interface MonthData {
  habits: Habit[];
  /** key: `${day}:${habitId}` */
  grid: Record<string, CellState>;
  observations: string[];
  keyGoals: KeyGoal[];
}

/**
 * How much text a field will take from here on.
 *
 * A month's ciphertext has a ceiling in the security rules, but these numbers
 * are not that ceiling divided up: a full month of ordinary use sits at a few
 * percent of it, and each limit below is simply the most anyone plausibly
 * wants to type into that particular field. The rule is the backstop for a
 * record that somehow arrives oversized — a paste of a whole document into a
 * multiline box is the obvious way — not the budget these are spent against.
 *
 * They apply to new typing only. Anything already saved, including values
 * written before these existed, is left exactly as it is.
 *
 * Every field that uses one sets it twice, as a `maxLength` prop and as a
 * slice inside `onChangeText`. The prop is what stops the keyboard and shows
 * the user where the end is; the slice is what actually holds, because
 * `maxLength` on a multiline input is not honoured by every Android IME.
 */
export const MAX_HABITS = 10;
export const MAX_HABIT_NAME = 24;
export const MAX_OBSERVATION_LEN = 280;
export const MAX_OBSERVATIONS = 12;
export const MAX_GOAL_LEN = 120;

export function emptyMonthData(): MonthData {
  return {
    habits: [],
    grid: {},
    observations: ['', '', '', ''],
    keyGoals: [
      { text: '', done: false },
      { text: '', done: false },
      { text: '', done: false },
    ],
  };
}

export function cellKey(day: number, habitId: string): string {
  return `${day}:${habitId}`;
}

export function nextHabitId(habits: Habit[]): string {
  const max = habits.reduce((m, h) => {
    const n = parseInt(h.id, 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, -1);
  return String(max + 1);
}

/** Per-day tally across all habits */
export function dayTally(
  grid: Record<string, CellState>,
  habits: Habit[],
  day: number
): { done: number; missed: number } {
  let done = 0;
  let missed = 0;
  for (const h of habits) {
    const s = grid[cellKey(day, h.id)] ?? 0;
    if (s === 1) done++;
    else if (s === 2) missed++;
  }
  return { done, missed };
}
