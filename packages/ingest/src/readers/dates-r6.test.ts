import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Round 6, item 5 (minor): a date cell is read as the date a person saw, never shifted by the time zone of the
// machine that reads it. A Date at UTC midnight is that UTC date (the convention of libraries that build dates in
// UTC); a Date at local midnight is that local date (the convention of SheetJS, which the web uses). Each zone runs
// in its own process, because the zone is read when the process starts.

const SCRIPT = `
import { toCellText } from ${JSON.stringify(join(import.meta.dir, "blocks.ts"))};
const out = [
  toCellText(new Date(Date.UTC(2025, 3, 1))),
  toCellText(new Date(2025, 3, 1)),
  toCellText(new Date(2025, 0, 31)),
  toCellText(new Date(Date.UTC(2025, 9, 31, 14, 30))),
  toCellText(new Date(2025, 11, 31)),
];
console.log(JSON.stringify(out));
`;

function inZone(tz: string): string[] {
  const r = Bun.spawnSync([process.execPath, "-e", SCRIPT], { env: { ...process.env, TZ: tz } });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  return JSON.parse(r.stdout.toString().trim());
}

describe("round 6: dates are never shifted by time zone", () => {
  for (const tz of ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Kiritimati"]) {
    test(`in ${tz}`, () => {
      expect(inZone(tz)).toEqual(["2025-04-01", "2025-04-01", "2025-01-31", "2025-10-31T14:30:00", "2025-12-31"]);
    });
  }
});
