import { describe, expect, test } from "bun:test";

import { auditInput, filtersActive, kindOf, metaText, parseAuditSearch, zonedDayEndMs, zonedDayStartMs } from "./model";

describe("audit filters", () => {
  test("a date starts at local midnight: 24 Oct in Kolkata is 23 Oct 18:30 UTC", () => {
    expect(zonedDayStartMs("2026-10-24", "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 23, 18, 30));
    expect(zonedDayEndMs("2026-10-24", "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 24, 18, 30) - 1);
  });

  test("zones west of UTC and with daylight saving still land on local midnight", () => {
    expect(zonedDayStartMs("2026-01-15", "America/New_York")).toBe(Date.UTC(2026, 0, 15, 5, 0));
    expect(zonedDayStartMs("2026-07-15", "America/New_York")).toBe(Date.UTC(2026, 6, 15, 4, 0));
    expect(zonedDayStartMs("2026-10-24", "UTC")).toBe(Date.UTC(2026, 9, 24));
  });

  test("the URL search is parsed tolerantly: bad kinds, dates and long values are dropped", () => {
    expect(parseAuditSearch({ kind: "dispatch", from: "2026-10-01", to: "2026-10-24", actor: "u1", subject: " abc " })).toEqual({
      kind: "dispatch",
      from: "2026-10-01",
      to: "2026-10-24",
      actor: "u1",
      subject: "abc",
    });
    expect(parseAuditSearch({ kind: "drop table", from: "yesterday", to: "2026-13-45", actor: "x".repeat(65), subject: "  " })).toEqual({});
    expect(filtersActive({})).toBe(false);
    expect(filtersActive({ kind: "die" })).toBe(true);
  });

  test("the server input uses a kind prefix, ids as typed, and the plant's day bounds", () => {
    expect(auditInput({ kind: "member", actor: "u1", subject: "m1", from: "2026-10-24", to: "2026-10-24" }, "Asia/Kolkata")).toEqual({
      actorId: "u1",
      action: "member.",
      subjectId: "m1",
      from: Date.UTC(2026, 9, 23, 18, 30),
      to: Date.UTC(2026, 9, 24, 18, 30) - 1,
    });
    expect(auditInput({}, "Asia/Kolkata")).toEqual({});
  });

  test("an action code's kind is its first part, when the filter offers it", () => {
    expect(kindOf("dispatch.complete")).toBe("dispatch");
    expect(kindOf("support_request.reply")).toBe("support_request");
    expect(kindOf("platform.company.modules.update")).toBeNull();
  });

  test("details print indented JSON, and nothing for an empty meta", () => {
    expect(metaText({})).toBe("");
    expect(metaText(null)).toBe("");
    expect(metaText({ from: "a", to: "b" })).toBe('{\n  "from": "a",\n  "to": "b"\n}');
  });
});
