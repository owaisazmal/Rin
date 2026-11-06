import { DAY } from '../dates';
import {
  REVIEW_GAP_DAYS,
  REVIEW_PERFECT_DAYS,
  parseReviewRecord,
  shouldAskForReview,
} from '../review';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

/** The rating prompt fires rarely, and only when the week has earned it. */

const NOW = Date.UTC(2026, 10, 5);
const fresh = { askedVersion: null, askedAt: null };
const ask = (over: Partial<Parameters<typeof shouldAskForReview>[0]> = {}) =>
  shouldAskForReview({ perfectDays: REVIEW_PERFECT_DAYS, version: '1.2.0', record: fresh, now: NOW, ...over });

describe('parseReviewRecord', () => {
  it('takes an empty record from anything that is not one', () => {
    expect(parseReviewRecord(null)).toEqual(fresh);
    expect(parseReviewRecord('1.2.0')).toEqual(fresh);
    expect(parseReviewRecord({ askedVersion: 3, askedAt: 'yesterday' })).toEqual(fresh);
    expect(parseReviewRecord({ askedAt: Number.NaN })).toEqual(fresh);
  });

  it('keeps a well-formed record', () => {
    expect(parseReviewRecord({ askedVersion: '1.1.0', askedAt: NOW })).toEqual({
      askedVersion: '1.1.0',
      askedAt: NOW,
    });
  });
});

describe('shouldAskForReview', () => {
  it('asks after a full clean week on a version that has not asked', () => {
    expect(ask()).toBe(true);
    expect(ask({ perfectDays: 30 })).toBe(true);
  });

  it('waits for the week', () => {
    expect(ask({ perfectDays: REVIEW_PERFECT_DAYS - 1 })).toBe(false);
    expect(ask({ perfectDays: 0 })).toBe(false);
  });

  it('asks once per version', () => {
    const record = { askedVersion: '1.2.0', askedAt: NOW - 400 * DAY };
    expect(ask({ record })).toBe(false);
    expect(ask({ record, version: '1.3.0' })).toBe(true);
  });

  it('keeps a long gap between asks across versions', () => {
    const recent = { askedVersion: '1.1.0', askedAt: NOW - (REVIEW_GAP_DAYS - 1) * DAY };
    expect(ask({ record: recent })).toBe(false);
    const old = { askedVersion: '1.1.0', askedAt: NOW - REVIEW_GAP_DAYS * DAY };
    expect(ask({ record: old })).toBe(true);
  });

  it('never asks without a version to record', () => {
    expect(ask({ version: null })).toBe(false);
  });
});
