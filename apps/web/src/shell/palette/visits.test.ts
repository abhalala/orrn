import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { pageVisitRecent } from "../command-palette";
import { recordBundleVisit } from "./record-bundle";
import { notePaletteVisit, readRecents, takePaletteVisit } from "./recents";
import { testMe } from "./test-me";

/** Route visits and the bundle page as sources of recents (QA F1, F2). */

const data = new Map<string, string>();
const storage = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
};
let hadWindow = false;
let previousWindow: unknown;

beforeEach(() => {
  data.clear();
  hadWindow = "window" in globalThis;
  previousWindow = (globalThis as { window?: unknown }).window;
  // A plain `window.localStorage` is all recents.ts reaches for.
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  takePaletteVisit("");
});

afterEach(() => {
  if (hadWindow) (globalThis as { window?: unknown }).window = previousWindow;
  else Reflect.deleteProperty(globalThis, "window");
});

describe("route visits (QA F1, F2)", () => {
  test("visiting a bundle path records nothing from the route: the bundle page does it once the bundle loads", () => {
    expect(pageVisitRecent("/b/NOPE-1", testMe("owner"))).toBeNull();
  });

  test("a nav page visit records the page", () => {
    expect(pageVisitRecent("/printing", testMe("owner"))).toEqual({ kind: "page", ref: "printing" });
    expect(pageVisitRecent("/printing", testMe("operator", { modules: ["customers"] }))?.ref).toBe("printing");
    expect(pageVisitRecent("/masters", testMe("viewer"))).toBeNull();
  });

  test("a section opened from the palette is not recorded again as its page", () => {
    notePaletteVisit("/printing");
    expect(pageVisitRecent("/printing", testMe("owner"))).toBeNull();
    // The mark is used up: a later real visit counts.
    expect(pageVisitRecent("/printing", testMe("owner"))).toEqual({ kind: "page", ref: "printing" });
  });

  test("a mark the route never reached (chosen on the same page) is cleared by the next visit, matching or not", () => {
    notePaletteVisit("/printing");
    expect(pageVisitRecent("/today", testMe("owner"))).toEqual({ kind: "page", ref: "today" });
    expect(pageVisitRecent("/printing", testMe("owner"))).toEqual({ kind: "page", ref: "printing" });
  });
});

describe("bundle page recents (QA F1)", () => {
  test("a loaded bundle is recorded with its own number and path", () => {
    recordBundleVisit(testMe("owner"), "26I4086");
    expect(readRecents("user-1", "plant-1")).toEqual([{ kind: "bundle", ref: "26I4086", label: "26I4086", mono: true, to: "/b/26I4086" }]);
  });

  test("never while impersonating, never without a plant", () => {
    recordBundleVisit(testMe("owner", { impersonating: true }), "26I4086");
    recordBundleVisit(null, "26I4086");
    expect(data.size).toBe(0);
  });
});
