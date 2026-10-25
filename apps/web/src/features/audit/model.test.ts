import { describe, expect, test } from "bun:test";

import { AUDIT_ACTION_WORDS, AUDIT_KINDS, AUDIT_KIND_ACTIONS, auditActionKey, auditInput, filtersActive, kindOf, lastChangeOf, metaEntries, parseAuditSearch, zonedDayEndMs, zonedDayStartMs } from "./model";

const WORDS = { yes: "Yes", no: "No", none: "none", change: (from: string, to: string) => `${from} to ${to}` };

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
      actions: ["member.", "auth.", "invite."],
      subjectId: "m1",
      from: Date.UTC(2026, 9, 23, 18, 30),
      to: Date.UTC(2026, 9, 24, 18, 30) - 1,
    });
    expect(auditInput({}, "Asia/Kolkata")).toEqual({});
  });

  test("an action code's kind is its first part, when the filter offers it", () => {
    expect(kindOf("dispatch.complete")).toBe("dispatch");
    expect(kindOf("support_request.reply")).toBe("support_request");
    expect(kindOf("platform.company.modules.update")).toBe("platform");
    expect(kindOf("die_instance.create")).toBe("die");
    expect(kindOf("nitriding.add")).toBe("die");
    expect(kindOf("move_found")).toBe("bundle");
    expect(kindOf("something_new.happened")).toBeNull();
  });

  test("every Kind has at least one action, no action sits in two Kinds, and the Kind list is the table's keys", () => {
    expect([...AUDIT_KINDS].sort()).toEqual(Object.keys(AUDIT_KIND_ACTIONS).sort());
    const all = AUDIT_KINDS.flatMap((k) => AUDIT_KIND_ACTIONS[k]);
    expect(new Set(all).size).toBe(all.length);
    for (const k of AUDIT_KINDS) expect(AUDIT_KIND_ACTIONS[k].length).toBeGreaterThan(0);
    // The prefixes the first cut missed.
    for (const prefix of ["die_instance.", "die_issue.", "die_band.", "die_owner.", "nitriding.", "approval.", "press_run.", "melt.", "cast.", "platform.", "impersonation.", "invite."]) {
      expect(all).toContain(prefix);
    }
  });

  test("details read as key and value, not JSON: a settings flip shows old to new, booleans in words", () => {
    expect(metaEntries({}, WORDS)).toEqual([]);
    expect(metaEntries(null, WORDS)).toEqual([]);
    expect(
      metaEntries({ changed: { portalEnabled: true, locale: "gu" }, previous: { portalEnabled: null, locale: "en" } }, WORDS),
    ).toEqual([
      { key: "portalEnabled", label: "Portal enabled", value: "none to Yes" },
      { key: "locale", label: "Locale", value: "en to gu" },
    ]);
    expect(metaEntries({ from: "Tablet 1", to: null }, WORDS)).toEqual([{ key: "from", label: "Changed", value: "Tablet 1 to none" }]);
    expect(metaEntries({ from: { mandatory: false }, to: { mandatory: true }, version: "1.2.0" }, WORDS)).toEqual([
      { key: "mandatory", label: "Mandatory", value: "No to Yes" },
      { key: "version", label: "Version", value: "1.2.0" },
    ]);
    expect(metaEntries({ sessionEnded: true, buildNumber: 12, tags: ["a", "b"], shifts: { a: 1 } }, WORDS)).toEqual([
      { key: "sessionEnded", label: "Session ended", value: "Yes" },
      { key: "buildNumber", label: "Build number", value: "12" },
      { key: "tags", label: "Tags", value: "a, b" },
      { key: "shifts", label: "Shifts", value: "a: 1" },
    ]);
  });

  test("the last change of one switch is the newest settings update that touched it", () => {
    const row = (at: string, changed: Record<string, unknown>, previous: Record<string, unknown>, action = "company.settings.update") => ({
      at,
      action,
      actorName: "Asha",
      byStaff: false,
      meta: { changed, previous },
    });
    const rows = [
      row("2026-10-24T10:00:00Z", { locale: "gu" }, { locale: "en" }),
      row("2026-10-23T10:00:00Z", { portalEnabled: true }, { portalEnabled: null }),
      row("2026-10-22T10:00:00Z", { portalEnabled: false }, { portalEnabled: true }),
      row("2026-10-21T10:00:00Z", { portalEnabled: true }, { portalEnabled: false }, "member.remove"),
    ];
    expect(lastChangeOf(rows, "portalEnabled")).toMatchObject({ at: "2026-10-23T10:00:00Z", actorName: "Asha", from: null, to: true });
    expect(lastChangeOf(rows, "dieBands")).toBeNull();
    expect(lastChangeOf([], "dieBands")).toBeNull();
  });
});

describe("wave-2 M5: audit actions read as words", () => {
  const { en } = require("@orrn/i18n/en") as typeof import("@orrn/i18n/en");
  const { hi } = require("@orrn/i18n/hi") as typeof import("@orrn/i18n/hi");
  const lookup = (dict: unknown, key: string) =>
    key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), dict);

  test("the explorer's raw codes have words in English and Hindi", () => {
    for (const action of ["packingList.combine", "order.hold", "count.start", "company.switch", "spectro.inbox.dismiss", "press.alert.ack", "company.settings.update", "dispatch.capacity_override", "packingList.regenerate"]) {
      const key = auditActionKey(action);
      expect({ action, key: key !== null }).toEqual({ action, key: true });
      expect(typeof lookup(en, key!)).toBe("string");
      expect(typeof lookup(hi, key!)).toBe("string");
    }
    expect(lookup(en, auditActionKey("order.hold")!)).toBe("Stock held for an order line");
  });

  test("every action the server writes as a literal has words; every listed one exists in en and hi", () => {
    const { readdirSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const root = join(import.meta.dir, "../../../../../packages/server/src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(root);
    const written = new Set<string>();
    for (const file of files) for (const m of readFileSync(file, "utf8").matchAll(/action: ["'`]([a-zA-Z_]+\.[a-zA-Z_.]+)["'`]/g)) written.add(m[1]!);
    expect(written.size).toBeGreaterThan(100);
    expect([...written].filter((a) => !AUDIT_ACTION_WORDS.has(a))).toEqual([]);
    for (const action of AUDIT_ACTION_WORDS) {
      const key = auditActionKey(action)!;
      expect({ action, en: typeof lookup(en, key), hi: typeof lookup(hi, key) }).toEqual({ action, en: "string", hi: "string" });
    }
    expect(auditActionKey("something.new")).toBeNull();
  });
});
