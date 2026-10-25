import { describe, expect, test } from "bun:test";

import { setSpeechOn, speechLang, speechOn } from "./speak";

function memory(): Storage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) } as Storage;
}

describe("spoken refusals", () => {
  test("language tags", () => {
    expect(speechLang("en")).toBe("en-IN");
    expect(speechLang("hi")).toBe("hi-IN");
    expect(speechLang("gu")).toBe("gu-IN");
    expect(speechLang("fr")).toBe("en-IN");
  });

  test("on by default, off once the person turns it off, on again when they do", () => {
    const s = memory();
    expect(speechOn(s)).toBe(true);
    setSpeechOn(s, false);
    expect(speechOn(s)).toBe(false);
    setSpeechOn(s, true);
    expect(speechOn(s)).toBe(true);
  });

  test("storage that throws leaves speech on", () => {
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(speechOn(bad as unknown as Storage)).toBe(true);
    expect(() => setSpeechOn(bad as unknown as Storage, false)).not.toThrow();
  });
});
