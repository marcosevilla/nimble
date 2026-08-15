/**
 * Parity vectors for the recurrence port.
 *
 * Every case here is lifted from the `#[cfg(test)] mod tests` block at the
 * bottom of `nimble-core/src/recurrence.rs`, in source order, with the Rust
 * test function that produced it named in `from`. This table is the contract
 * between the two implementations: if you add a Rust test, add its case here;
 * if you change Rust behavior, change the expectation here and in
 * `recurrence.ts` together.
 *
 * Verify with:  npx tsx apps/desktop/src/services/turso/recurrence.selfcheck.ts
 */

import type { RecurrenceRule } from './recurrence'

/** `parse_rule(input)` must equal `expected` (null = Rust's `None`). */
export interface ParseVector {
  kind: 'parse'
  from: string
  input: string
  expected: RecurrenceRule | null
}

/** `next_occurrence(rule, currentDue, today)` must equal `expected`. */
export interface NextVector {
  kind: 'next'
  from: string
  /** A rule string parsed via `parseRule` (the Rust test does `.unwrap()`). */
  rule?: string
  /** …or a hand-built rule, for the cases where the Rust test bypasses the parser. */
  builtRule?: RecurrenceRule
  currentDue: string
  today: string
  expected: string
}

/**
 * `next_occurrence(...)` must be strictly after `after`. Used where the Rust
 * test only asserts `result > d(...)` rather than an exact date. The
 * `alsoExactly` field records the exact value the real Rust produces — it is
 * NOT asserted by the Rust test, it was captured from an oracle binary that
 * `include!`s the real `recurrence.rs` (see the report for this port). Treat a
 * mismatch there as a signal to re-run that oracle, not as a hard contract.
 */
export interface NextAfterVector {
  kind: 'nextAfter'
  from: string
  builtRule: RecurrenceRule
  currentDue: string
  today: string
  after: string
  alsoExactly: string
}

export type Vector = ParseVector | NextVector | NextAfterVector

export const VECTORS: Vector[] = [
  // --- fn parses_marcos_real_rules ---
  {
    kind: 'parse',
    from: 'parses_marcos_real_rules',
    input: 'every month',
    expected: { interval: 1, unit: 'month', time: null },
  },
  {
    kind: 'parse',
    from: 'parses_marcos_real_rules',
    input: 'every 2 weeks @ 09:00',
    expected: { interval: 2, unit: 'week', time: '09:00' },
  },
  {
    kind: 'parse',
    from: 'parses_marcos_real_rules',
    input: 'Every Day',
    expected: { interval: 1, unit: 'day', time: null },
  },
  {
    kind: 'parse',
    from: 'parses_marcos_real_rules',
    input: 'every 3 months at 9am',
    expected: { interval: 3, unit: 'month', time: '09:00' },
  },

  // --- fn rejects_unsupported_strings ---
  { kind: 'parse', from: 'rejects_unsupported_strings', input: 'every 3rd tuesday', expected: null },
  { kind: 'parse', from: 'rejects_unsupported_strings', input: 'weekdays', expected: null },
  { kind: 'parse', from: 'rejects_unsupported_strings', input: 'every!', expected: null },
  { kind: 'parse', from: 'rejects_unsupported_strings', input: '', expected: null },
  { kind: 'parse', from: 'rejects_unsupported_strings', input: 'tomorrow', expected: null },
  { kind: 'parse', from: 'rejects_unsupported_strings', input: 'every 0 days', expected: null },

  // --- fn completed_early_advances_one_interval_from_due ---
  // due 8/16, completed 8/10 → next 8/30 (from due, not from completion day)
  {
    kind: 'next',
    from: 'completed_early_advances_one_interval_from_due',
    rule: 'every 2 weeks @ 09:00',
    currentDue: '2026-08-16',
    today: '2026-08-10',
    expected: '2026-08-30',
  },

  // --- fn completed_late_advances_past_today ---
  // due 8/27, completed 10/02 → next 10/27 (skips the already-past 9/27)
  {
    kind: 'next',
    from: 'completed_late_advances_past_today',
    rule: 'every month',
    currentDue: '2026-08-27',
    today: '2026-10-02',
    expected: '2026-10-27',
  },

  // --- fn month_end_clamps ---
  {
    kind: 'next',
    from: 'month_end_clamps',
    rule: 'every month',
    currentDue: '2026-01-31',
    today: '2026-01-31',
    expected: '2026-02-28',
  },
  {
    kind: 'next',
    from: 'month_end_clamps (leap year)',
    rule: 'every month',
    currentDue: '2028-01-31',
    today: '2028-01-31',
    expected: '2028-02-29',
  },

  // --- fn yearly_and_daily ---
  {
    kind: 'next',
    from: 'yearly_and_daily',
    rule: 'every year',
    currentDue: '2026-03-06',
    today: '2026-03-06',
    expected: '2027-03-06',
  },
  {
    kind: 'next',
    from: 'yearly_and_daily',
    rule: 'every day',
    currentDue: '2026-08-09',
    today: '2026-08-09',
    expected: '2026-08-10',
  },

  // --- fn parses_time_variants ---
  {
    kind: 'parse',
    from: 'parses_time_variants',
    input: 'every week at 5pm',
    expected: { interval: 1, unit: 'week', time: '17:00' },
  },
  {
    kind: 'parse',
    from: 'parses_time_variants',
    input: 'every day at 12am',
    expected: { interval: 1, unit: 'day', time: '00:00' },
  },
  {
    kind: 'parse',
    from: 'parses_time_variants',
    input: 'every day at 12pm',
    expected: { interval: 1, unit: 'day', time: '12:00' },
  },
  {
    kind: 'parse',
    from: 'parses_time_variants',
    input: 'every day at 9:30am',
    expected: { interval: 1, unit: 'day', time: '09:30' },
  },

  // --- fn rejects_more_malformed_strings ---
  // "at" with nothing following
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every day at', expected: null },
  // "@" with nothing following
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every day @', expected: null },
  // out-of-range 12h hour
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every day at 13pm', expected: null },
  // out-of-range 24h hour
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every day @ 25:00', expected: null },
  // out-of-range minutes
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every day @ 09:99', expected: null },
  // negative interval unparsable as u32
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every -1 days', expected: null },
  // bare plural with no count is not in the grammar
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every months', expected: null },
  // count with singular unit is not in the grammar
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every 2 day', expected: null },
  // missing unit
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every 2', expected: null },
  // nothing after "every"
  { kind: 'parse', from: 'rejects_more_malformed_strings', input: 'every', expected: null },

  // --- fn is_case_insensitive_and_trims_whitespace ---
  {
    kind: 'parse',
    from: 'is_case_insensitive_and_trims_whitespace',
    input: '  EVERY   Month  ',
    expected: { interval: 1, unit: 'month', time: null },
  },

  // --- fn next_occurrence_never_returns_today_even_when_interval_lands_on_it ---
  // Advancing by one interval lands exactly on `today`, so it keeps advancing.
  {
    kind: 'next',
    from: 'next_occurrence_never_returns_today_even_when_interval_lands_on_it',
    rule: 'every week',
    currentDue: '2026-08-02',
    today: '2026-08-09',
    expected: '2026-08-16',
  },

  // --- fn year_leap_day_clamps_to_feb_28_on_non_leap_year ---
  {
    kind: 'next',
    from: 'year_leap_day_clamps_to_feb_28_on_non_leap_year',
    rule: 'every year',
    currentDue: '2028-02-29',
    today: '2028-02-29',
    expected: '2029-02-28',
  },

  // --- fn rejects_zero_interval_at_parse_time ---
  { kind: 'parse', from: 'rejects_zero_interval_at_parse_time', input: 'every 0 days', expected: null },
  { kind: 'parse', from: 'rejects_zero_interval_at_parse_time', input: 'every 0 weeks', expected: null },

  // --- fn next_occurrence_does_not_hang_on_a_hand_built_zero_interval_rule ---
  // Hand-built (fields are `pub` in Rust): must terminate and behave as interval 1.
  {
    kind: 'next',
    from: 'next_occurrence_does_not_hang_on_a_hand_built_zero_interval_rule',
    builtRule: { interval: 0, unit: 'day', time: null },
    currentDue: '2026-08-09',
    today: '2026-08-09',
    expected: '2026-08-10',
  },
  {
    kind: 'next',
    from: 'next_occurrence_does_not_hang_on_a_hand_built_zero_interval_rule',
    builtRule: { interval: 0, unit: 'month', time: null },
    currentDue: '2026-08-09',
    today: '2026-08-09',
    expected: '2026-09-09',
  },

  // --- fn rejects_absurdly_large_intervals_at_parse_time ---
  { kind: 'parse', from: 'rejects_absurdly_large_intervals_at_parse_time', input: 'every 4294967295 months', expected: null },
  { kind: 'parse', from: 'rejects_absurdly_large_intervals_at_parse_time', input: 'every 999999999 days', expected: null },
  { kind: 'parse', from: 'rejects_absurdly_large_intervals_at_parse_time', input: 'every 100001 weeks', expected: null },
  // Right at the boundary should still parse (Rust only asserts `.is_some()`;
  // the full rule value is the obvious one and is oracle-confirmed).
  {
    kind: 'parse',
    from: 'rejects_absurdly_large_intervals_at_parse_time (boundary)',
    input: 'every 100000 days',
    expected: { interval: 100000, unit: 'day', time: null },
  },

  // --- fn next_occurrence_does_not_panic_on_a_hand_built_huge_interval_rule ---
  // interval u32::MAX is clamped to MAX_INTERVAL (100_000) before any arithmetic.
  // Note the `+` on the year: chrono's %Y signs any year outside 0..=9999, and
  // this port reproduces that rather than silently disagreeing.
  {
    kind: 'nextAfter',
    from: 'next_occurrence_does_not_panic_on_a_hand_built_huge_interval_rule',
    builtRule: { interval: 4294967295, unit: 'year', time: null },
    currentDue: '2026-08-09',
    today: '2026-08-09',
    after: '2026-08-09',
    alsoExactly: '+102026-08-09',
  },
  {
    kind: 'nextAfter',
    from: 'next_occurrence_does_not_panic_on_a_hand_built_huge_interval_rule',
    builtRule: { interval: 4294967295, unit: 'month', time: null },
    currentDue: '2026-08-09',
    today: '2026-08-09',
    after: '2026-08-09',
    alsoExactly: '+10359-12-09',
  },
  {
    kind: 'nextAfter',
    from: 'next_occurrence_does_not_panic_on_a_hand_built_huge_interval_rule',
    builtRule: { interval: 4294967295, unit: 'week', time: null },
    currentDue: '2026-08-09',
    today: '2026-08-09',
    after: '2026-08-09',
    alsoExactly: '3943-02-21',
  },
]
