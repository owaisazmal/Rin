import { DAY } from './dates';
import { readJson, writeJson } from './storage';
import { isRecord } from './types';

// When the app may ask for a store rating, and the record of having asked.

const REVIEW_KEY = '@monthly-planning/review';

/** A full clean week: every habit done, seven days running */
export const REVIEW_PERFECT_DAYS = 7;
/** A version asks once, and no version asks within this many days of the last ask */
export const REVIEW_GAP_DAYS = 120;

export interface ReviewRecord {
  askedVersion: string | null;
  /** ms since the epoch */
  askedAt: number | null;
}

export function parseReviewRecord(raw: unknown): ReviewRecord {
  const p = isRecord(raw) ? raw : {};
  return {
    askedVersion: typeof p.askedVersion === 'string' ? p.askedVersion : null,
    askedAt: typeof p.askedAt === 'number' && Number.isFinite(p.askedAt) ? p.askedAt : null,
  };
}

/** The rule: a clean week, a version that has not asked, and a long gap since any ask */
export function shouldAskForReview({
  perfectDays,
  version,
  record,
  now,
}: {
  perfectDays: number;
  version: string | null;
  record: ReviewRecord;
  now: number;
}): boolean {
  if (!version || perfectDays < REVIEW_PERFECT_DAYS) return false;
  if (record.askedVersion === version) return false;
  if (record.askedAt !== null && now - record.askedAt < REVIEW_GAP_DAYS * DAY) return false;
  return true;
}

export async function loadReviewRecord(): Promise<ReviewRecord> {
  return parseReviewRecord(await readJson(REVIEW_KEY));
}

export function saveReviewRecord(record: ReviewRecord): Promise<void> {
  return writeJson(REVIEW_KEY, record);
}
