/**
 * Wall clock used by document numbering paths so tests can pin "now" (a test that runs at a
 * month boundary must not flake). Production code never sets the override.
 */
let override: number | null = null;

export function now(): Date {
  return new Date(override ?? Date.now());
}

/** Test hook: pin the clock to `at`, or pass `null` to return to real time. */
export function setClockForTests(at: Date | null): void {
  override = at ? at.getTime() : null;
}
