import { describe, expect, test } from "bun:test";

import { FORBIDDEN_LABEL_VARIABLES, LABEL_VARIABLES } from "./labelContract";
import { bundleQrUrl } from "./qr";
import { classifyCode, parseScan } from "./serial";

/**
 * BACKLOG 54: the frozen label contract. Changing anything here changes what printed labels mean;
 * that needs a decision (Q31) and a migration plan for labels already in the yard, not a test edit.
 */
describe("QR payload: the bundle number only", () => {
  test("the URL is origin/b/{number}?c={slug} and carries nothing else", () => {
    const url = new URL(bundleQrUrl({ origin: "https://orrn.in", number: "26J4086", companySlug: "fourcubes" }));
    expect(url.origin).toBe("https://orrn.in");
    expect(url.pathname).toBe("/b/26J4086");
    expect([...url.searchParams.keys()]).toEqual(["c"]);
    expect(url.searchParams.get("c")).toBe("fourcubes");
    expect(url.hash).toBe("");
  });

  test("every printed and legacy form reads back as the number", () => {
    const cases: [string, ReturnType<typeof classifyCode>][] = [
      ["https://orrn.in/b/26J4086?c=fourcubes", { kind: "plant", serial: "26J4086", year: 2026, month: 10, seq: 4086 }],
      ["https://fourcubes.orrn.in/b/26J4086", { kind: "plant", serial: "26J4086", year: 2026, month: 10, seq: 4086 }],
      ["26J4086", { kind: "plant", serial: "26J4086", year: 2026, month: 10, seq: 4086 }],
      ["J540", { kind: "monthOnly", serial: "J540", month: 10, seq: 540 }],
      ["https://orrn.in/b/BG-000001-B001?c=fourcubes", { kind: "serial", serial: "BG-000001-B001" }],
      ["BG-000001-B001", { kind: "serial", serial: "BG-000001-B001" }],
    ];
    for (const [raw, want] of cases) expect({ raw, got: classifyCode(raw) }).toEqual({ raw, got: want });
    // An old FCMS label QR (a cuid) still resolves through the legacy map.
    expect(classifyCode("ckz1x2y3z4a5b6c7d8e9f0g1h")).toEqual({ kind: "cuid", id: "ckz1x2y3z4a5b6c7d8e9f0g1h" });
    expect(parseScan("https://orrn.in/b/26J4086?c=fourcubes")).toEqual({ kind: "serial", serial: "26J4086" });
  });
});

describe("label template variables", () => {
  test("are exactly the frozen list", () => {
    expect([...LABEL_VARIABLES]).toEqual([
      "length",
      "poNumber",
      "quantity",
      "serialNumber",
      "seriesName",
      "weight",
      "weight12ft",
      "weight_each",
      "layout",
      "cast",
      "qr",
      "salesOrder",
      "standard",
      "cml",
      "partyNo",
      "showLogo",
    ]);
  });

  test("offer no id a template could put in the QR", () => {
    for (const name of FORBIDDEN_LABEL_VARIABLES) expect(LABEL_VARIABLES as readonly string[]).not.toContain(name);
    expect(LABEL_VARIABLES.filter((v) => /id$/i.test(v))).toEqual([]);
  });
});
