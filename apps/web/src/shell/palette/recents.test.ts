import { describe, expect, test } from "bun:test";

import { clearRecents, pushRecent, readRecents, recentStorageKey, RECENT_LIMIT } from "./recents";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const boom = () => {
  throw new Error("blocked");
};

describe("palette recents", () => {
  test("newest first, deduplicated, at most 8", () => {
    const s = memoryStorage();
    for (let i = 0; i < 10; i++) pushRecent("u", "c", { kind: "page", ref: `p${i}` }, s);
    pushRecent("u", "c", { kind: "page", ref: "p5" }, s);
    const list = readRecents("u", "c", s);
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list.map((r) => r.ref)).toEqual(["p5", "p9", "p8", "p7", "p6", "p4", "p3", "p2"]);
  });

  test("kept per company and per user", () => {
    const s = memoryStorage();
    pushRecent("u", "c1", { kind: "page", ref: "stock" }, s);
    expect(readRecents("u", "c2", s)).toEqual([]);
    expect(readRecents("v", "c1", s)).toEqual([]);
    expect(readRecents("u", "c1", s)).toEqual([{ kind: "page", ref: "stock" }]);
  });

  test("remote rows keep label and path; bad rows are dropped", () => {
    const s = memoryStorage();
    s.setItem(
      recentStorageKey("u", "c"),
      JSON.stringify([
        { kind: "bundle", ref: "26I4086", label: "26I4086", to: "/b/26I4086", mono: true },
        { kind: "dispatch", ref: "d1", label: "DSP-1", to: "//evil.example" },
        { kind: "customer", ref: "c1" },
        { kind: "weird", ref: "x" },
        "nonsense",
      ]),
    );
    expect(readRecents("u", "c", s)).toEqual([{ kind: "bundle", ref: "26I4086", label: "26I4086", to: "/b/26I4086", mono: true }]);
  });

  test("clear removes the list", () => {
    const s = memoryStorage();
    pushRecent("u", "c", { kind: "page", ref: "stock" }, s);
    clearRecents("u", "c", s);
    expect(readRecents("u", "c", s)).toEqual([]);
  });

  test("storage that throws or holds junk means no recents, never an error", () => {
    const throwing = { getItem: boom, setItem: boom, removeItem: boom };
    expect(readRecents("u", "c", throwing)).toEqual([]);
    expect(pushRecent("u", "c", { kind: "page", ref: "stock" }, throwing)).toEqual([{ kind: "page", ref: "stock" }]);
    expect(() => clearRecents("u", "c", throwing)).not.toThrow();

    const corrupt = memoryStorage();
    corrupt.setItem(recentStorageKey("u", "c"), "{not json");
    expect(readRecents("u", "c", corrupt)).toEqual([]);

    expect(readRecents("u", "c", null)).toEqual([]);
  });

  test("the default storage getter throwing is caught", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage() {
          throw new Error("SecurityError");
        },
      },
    });
    try {
      expect(readRecents("u", "c")).toEqual([]);
      expect(pushRecent("u", "c", { kind: "page", ref: "stock" })).toEqual([{ kind: "page", ref: "stock" }]);
      expect(() => clearRecents("u", "c")).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
