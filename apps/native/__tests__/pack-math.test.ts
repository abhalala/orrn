import { describe, expect, test } from "bun:test";

import {
  draftTotals,
  lengthFieldsToMm,
  lengthToFields,
  parsePieces,
  parseWeightG,
  receiptPayload,
  type DraftBundle,
} from "../features/pack/pack-math";
import { findLandedSession } from "../features/pack/save-check";
import { recentDieIds } from "../features/pack/recent-dies";
import { parseDraft, serializeDraft, type PackDraft } from "../features/pack/draft-store";

describe("weight field (kg typed, whole grams stored)", () => {
  test("a dot or a comma is the decimal point (iOS decimal pad in comma regions)", () => {
    expect(parseWeightG("52.4")).toBe(52_400);
    expect(parseWeightG("52,40")).toBe(52_400);
    expect(parseWeightG(" 7.125 ")).toBe(7_125);
    expect(parseWeightG("45,5")).toBe(45_500);
    expect(parseWeightG(".5")).toBe(500);
  });

  test("rejects empty, zero, signs, exponents, grouping and junk", () => {
    for (const bad of ["", " ", "0", "0.0", "-1", "+3", "1e3", "52.4.1", "1,234.5", "52,4,0", "abc", "52 kg", "5..2"]) {
      expect({ bad, g: parseWeightG(bad) }).toEqual({ bad, g: null });
    }
  });
});

describe("pieces field", () => {
  test("whole positive numbers only", () => {
    expect(parsePieces("21")).toBe(21);
    expect(parsePieces(" 3 ")).toBe(3);
    for (const bad of ["", "0", "2.5", "2,5", "-4", "1e2", "x", "100001"]) {
      expect({ bad, n: parsePieces(bad) }).toEqual({ bad, n: null });
    }
  });
});

describe("cut length in the company unit", () => {
  test("mm companies type mm", () => {
    expect(lengthFieldsToMm("mm", { mm: "3658", feet: "", inches: "" })).toBe(3658);
    expect(lengthFieldsToMm("mm", { mm: "", feet: "12", inches: "" })).toBeNull();
  });

  test("inch companies type feet and inches: 11 ft 6 in stores 3505 mm (Review Focus 4)", () => {
    expect(lengthFieldsToMm("inch", { mm: "", feet: "11", inches: "6" })).toBe(3505);
    expect(lengthFieldsToMm("inch", { mm: "", feet: "12", inches: "" })).toBe(3658);
    // A stray mm value is never read as inches.
    expect(lengthFieldsToMm("inch", { mm: "3658", feet: "", inches: "" })).toBeNull();
  });

  test("stored mm goes back into the fields for editing", () => {
    expect(lengthToFields(3658, "inch")).toEqual({ mm: "", feet: "12", inches: "" });
    expect(lengthToFields(3505, "inch")).toEqual({ mm: "", feet: "11", inches: "6" });
    expect(lengthToFields(3658, "mm")).toEqual({ mm: "3658", feet: "", inches: "" });
  });
});

const bundle = (over: Partial<DraftBundle> = {}): DraftBundle => ({
  key: "k1",
  weightG: 52_400,
  pieces: 21,
  lengthMm: null,
  po: null,
  ...over,
});

describe("receipt payload", () => {
  test("totals add bundles, pieces and grams", () => {
    expect(draftTotals([bundle(), bundle({ weightG: 10_000, pieces: 4 })])).toEqual({
      bundles: 2,
      pieces: 25,
      weightG: 62_400,
    });
  });

  test("bundles inherit the session cut length and PO unless they override them", () => {
    const payload = receiptPayload({
      dieId: "die-1",
      unit: "inch",
      defaults: { lengthMm: 3658, po: "PO-7" },
      locationId: undefined,
      bundles: [bundle(), bundle({ key: "k2", lengthMm: 3505, po: "PO-9" })],
    });
    expect(payload).toEqual({
      dieId: "die-1",
      unit: "inch",
      purchaseOrderRef: "PO-7",
      rows: [
        { quantity: 21, weightG: 52_400, lengthMm: 3658, poNumber: "PO-7" },
        { quantity: 21, weightG: 52_400, lengthMm: 3505, poNumber: "PO-9" },
      ],
    });
  });

  test("a yard goes along only when one was chosen; a blank PO is null", () => {
    const payload = receiptPayload({
      dieId: "die-1",
      unit: "mm",
      defaults: { lengthMm: 6000, po: "  " },
      locationId: "yard-2",
      bundles: [bundle()],
    });
    expect(payload.locationId).toBe("yard-2");
    expect(payload.purchaseOrderRef).toBeNull();
    expect(payload.rows[0]!.poNumber).toBeNull();
  });

  test("a 40-bundle session is one request under the server's 200-row cap (Review Focus 2)", () => {
    const bundles = Array.from({ length: 40 }, (_, i) => bundle({ key: `k${i}`, weightG: 50_000 + i }));
    const payload = receiptPayload({ dieId: "d", unit: "mm", defaults: { lengthMm: 3658, po: null }, locationId: undefined, bundles });
    expect(payload.rows).toHaveLength(40);
    expect(payload.rows.every((r) => r.lengthMm === 3658)).toBe(true);
  });
});

describe("an unsure save is checked before Save is offered again (T28 rule, ruling T29)", () => {
  const startedAt = Date.parse("2026-10-06T10:00:00Z");
  const group = (over: Partial<{ id: string; dieId: string; bundleCount: number; createdAt: string }>) => ({
    id: "g1",
    dieId: "die-1",
    bundleCount: 3,
    createdAt: "2026-10-06T10:00:02Z",
    ...over,
  });

  test("a session for the same die and bundle count created since the save started is the one that landed", () => {
    expect(findLandedSession([group({})], { dieId: "die-1", bundleCount: 3, startedAt })?.id).toBe("g1");
  });

  test("older sessions, other dies and other counts do not count", () => {
    const rows = [
      group({ id: "old", createdAt: "2026-10-06T09:58:00Z" }),
      group({ id: "other-die", dieId: "die-2" }),
      group({ id: "other-count", bundleCount: 4 }),
    ];
    expect(findLandedSession(rows, { dieId: "die-1", bundleCount: 3, startedAt })).toBeNull();
  });

  test("a little clock skew between phone and server is allowed", () => {
    const rows = [group({ createdAt: "2026-10-06T09:59:40Z" })];
    expect(findLandedSession(rows, { dieId: "die-1", bundleCount: 3, startedAt })?.id).toBe("g1");
  });
});

describe("recent dies come from recent sessions, not the newest die page (T20-quality gotcha)", () => {
  test("unique die ids in session order, capped", () => {
    const sessions = [{ dieId: "a" }, { dieId: "b" }, { dieId: "a" }, { dieId: "c" }, { dieId: "d" }];
    expect(recentDieIds(sessions, 3)).toEqual(["a", "b", "c"]);
    expect(recentDieIds([], 5)).toEqual([]);
  });
});

describe("pack draft file", () => {
  const draft: PackDraft = {
    version: 1,
    owner: "user-1:company-1",
    die: { id: "die-1", label: "14701 PATTI", weightMinG: 2_400, weightMaxG: 2_600 },
    unit: "inch",
    lengthFields: { mm: "", feet: "12", inches: "" },
    po: "PO-7",
    locationId: null,
    bundles: [bundle()],
    savedAt: 1,
  };

  test("round-trips", () => {
    expect(parseDraft(serializeDraft(draft), "user-1:company-1")).toEqual(draft);
  });

  test("another person's or another company's draft is never offered", () => {
    expect(parseDraft(serializeDraft(draft), "user-2:company-1")).toBeNull();
  });

  test("junk, an empty draft or an old version reads as no draft", () => {
    expect(parseDraft("not json", "user-1:company-1")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, version: 0 }), "user-1:company-1")).toBeNull();
    expect(parseDraft(serializeDraft({ ...draft, bundles: [] }), "user-1:company-1")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, bundles: [{ key: "x", weightG: "52" }] }), "user-1:company-1")).toBeNull();
  });
});
