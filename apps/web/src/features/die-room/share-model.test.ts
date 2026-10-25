import { describe, expect, test } from "bun:test";

import {
  canRevokeShare,
  DEFAULT_SHARE_DAYS,
  kgText,
  openedWords,
  sectionLabel,
  SHARE_DAY_CHOICES,
  shareFailure,
  shareLink,
  shareStatusTone,
  wallText,
} from "./share-model";

describe("share model", () => {
  test("the sheet offers 7 days by default and never more than 30", () => {
    expect(DEFAULT_SHARE_DAYS).toBe(7);
    expect(SHARE_DAY_CHOICES).toContain(DEFAULT_SHARE_DAYS);
    expect(Math.max(...SHARE_DAY_CHOICES)).toBe(30);
    expect(Math.min(...SHARE_DAY_CHOICES)).toBe(1);
  });

  test("only an open link can be revoked; the tone follows the status", () => {
    expect(canRevokeShare("active")).toBe(true);
    expect(canRevokeShare("expired")).toBe(false);
    expect(canRevokeShare("revoked")).toBe(false);
    expect([shareStatusTone("active"), shareStatusTone("expired"), shareStatusTone("revoked")]).toEqual(["green", "neutral", "red"]);
  });

  test("the link joins origin and path with one slash", () => {
    expect(shareLink("https://fourcubes.orrn.in", "/share/die/abc")).toBe("https://fourcubes.orrn.in/share/die/abc");
    expect(shareLink("https://fourcubes.orrn.in/", "share/die/abc")).toBe("https://fourcubes.orrn.in/share/die/abc");
  });

  test("a refused public read is gone, busy or an error", () => {
    expect(shareFailure({ data: { code: "NOT_FOUND" } })).toBe("gone");
    expect(shareFailure({ data: { code: "TOO_MANY_REQUESTS" } })).toBe("busy");
    expect(shareFailure({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe("error");
    expect(shareFailure(new TypeError("Failed to fetch"))).toBe("error");
    expect(shareFailure(null)).toBe("error");
  });

  test("figures are plain text", () => {
    expect(kgText(5_900)).toBe("5.900");
    expect(wallText(12)).toBe("1.2");
    expect(wallText(0)).toBeNull();
    expect(wallText(null)).toBeNull();
    expect(sectionLabel({ series: "Domal", sectionCode: "12170" })).toBe("Domal 12170");
    expect(openedWords(0)).toEqual({ key: "neverOpened", n: 0 });
    expect(openedWords(1)).toEqual({ key: "openedOnce", n: 1 });
    expect(openedWords(4)).toEqual({ key: "opened", n: 4 });
  });
});
