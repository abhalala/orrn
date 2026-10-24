import { describe, expect, test } from "bun:test";

import { composeRequestNotes, REQUEST_NOTES_MAX } from "./request-notes";

describe("composeRequestNotes", () => {
  test("nothing filled in sends no notes", () => {
    expect(composeRequestNotes({})).toBeUndefined();
    expect(composeRequestNotes({ lines: " ", date: "", time: "", notes: "  " })).toBeUndefined();
  });

  test("lines, preferred slot and the person's own words, one per line", () => {
    expect(
      composeRequestNotes({ lines: "3", date: "2026-10-10", time: "15:00", notes: "Two presses on day shift." }),
    ).toBe("Extrusion lines: 3\nPreferred time: 2026-10-10 15:00\n\nTwo presses on day shift.");
    expect(composeRequestNotes({ date: "2026-10-10" })).toBe("Preferred time: 2026-10-10");
    expect(composeRequestNotes({ time: "09:30" })).toBe("Preferred time: 09:30");
    expect(composeRequestNotes({ notes: "Call after 5" })).toBe("Call after 5");
  });

  test("never longer than the server accepts", () => {
    const long = "x".repeat(900);
    const out = composeRequestNotes({ lines: "12", date: "2026-10-10", time: "15:00", notes: long })!;
    expect(out.length).toBe(REQUEST_NOTES_MAX);
    expect(out.startsWith("Extrusion lines: 12\nPreferred time: 2026-10-10 15:00\n\nxxx")).toBe(true);
  });
});
