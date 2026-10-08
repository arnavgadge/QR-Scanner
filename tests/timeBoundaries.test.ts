// Phase 11: "today" and date-range maths around midnight and daylight-saving changes.
import { afterEach, describe, expect, it } from 'vitest';
import { inclusiveRange, localDayRange } from '../src/services/admin/dateRanges';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('local-day boundaries', () => {
  it('the last millisecond of a day belongs to that day; the next midnight starts the next', () => {
    const lastMs = new Date(2026, 9, 3, 23, 59, 59, 999);
    const midnight = new Date(2026, 9, 4, 0, 0, 0, 0);
    const a = localDayRange(lastMs);
    const b = localDayRange(midnight);
    expect(a.end.getTime()).toBe(midnight.getTime());
    expect(b.start.getTime()).toBe(midnight.getTime());
    expect(lastMs.getTime()).toBeLessThan(a.end.getTime());
    expect(midnight.getTime()).toBeGreaterThanOrEqual(b.start.getTime());
  });

  it('month and year rollovers', () => {
    expect(localDayRange(new Date(2026, 11, 31, 12)).end).toEqual(new Date(2027, 0, 1));
    expect(localDayRange(new Date(2028, 1, 29, 12)).end).toEqual(new Date(2028, 2, 1)); // leap day
  });

  it('a daylight-saving day is 23 or 25 hours long, never assumed to be 24', () => {
    process.env.TZ = 'America/New_York';
    const spring = localDayRange(new Date(2026, 2, 8, 12)); // clocks go forward
    const autumn = localDayRange(new Date(2026, 10, 1, 12)); // clocks go back
    expect((spring.end.getTime() - spring.start.getTime()) / 3600_000).toBe(23);
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3600_000).toBe(25);
    // the end of the range is still the next LOCAL midnight
    expect(spring.end).toEqual(new Date(2026, 2, 9));
  });

  it('a date filter "from X to X" covers exactly that local day (end is exclusive next midnight)', () => {
    const r = inclusiveRange('2026-10-03', '2026-10-03');
    expect(r.from).toEqual(new Date(2026, 9, 3));
    expect(r.to).toEqual(new Date(2026, 9, 4));
    const spring =
      ((process.env.TZ = 'America/New_York'), inclusiveRange('2026-03-08', '2026-03-08'));
    expect((spring.to!.getTime() - spring.from!.getTime()) / 3600_000).toBe(23);
  });
});
