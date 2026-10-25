import { describe, expect, test } from "bun:test";

import { releaseNoteRows } from "./release-notes";

const at = Date.UTC(2026, 9, 20, 6, 0, 0);

describe("FP-PF-14 release notes on About", () => {
  test("keeps the server's order, formats the day, drops blank notes and unknown platforms", () => {
    const rows = releaseNoteRows(
      [
        { id: "a", platform: "android", channel: "production", version: "1.4.0", buildNumber: 14, mandatory: true, notes: " Pack screen faster ", publishedAt: at },
        { id: "b", platform: "ios", channel: "production", version: "1.3.0", buildNumber: null, mandatory: false, notes: "Dies tab", publishedAt: at - 86_400_000 },
        { id: "c", platform: "edge", channel: "production", version: "2.0.0", buildNumber: 2, mandatory: false, notes: "Spool", publishedAt: at },
        { id: "d", platform: "android", channel: "floor", version: "1.2.0", buildNumber: 12, mandatory: false, notes: "  ", publishedAt: at },
      ],
      { locale: "en", now: new Date(at) },
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({ platform: "android", version: "1.4.0", build: "14", notes: "Pack screen faster", mandatory: true, day: "20 Oct" });
    expect(rows[1]).toMatchObject({ build: "-", day: "19 Oct" });
  });
  test("none yet: empty", () => {
    expect(releaseNoteRows(undefined)).toEqual([]);
    expect(releaseNoteRows([])).toEqual([]);
  });
});
