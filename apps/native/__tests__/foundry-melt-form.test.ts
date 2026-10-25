import { describe, expect, test } from "bun:test";

import {
  blankForm,
  figuresOf,
  formFromMelt,
  ftToMm,
  inchToTenth,
  kgToG,
  lineKey,
  mmToFtText,
  qtyToMilli,
  sameForm,
  saveInputOf,
  tenthToInchText,
  type MeltForm,
  type SavedMelt,
} from "../features/foundry/melt-form";

const IST = "Asia/Kolkata";
const ctx = { castId: "cast-1", timeZone: IST };

function filled(): MeltForm {
  const f = blankForm("2026-10-24", "furnace-1");
  f.times = { preheatStart: "06:00", chargingStart: "07:10", chargingEnd: "08:40", castingStart: "14:20", castingEnd: "17:05" };
  f.lots = [{ key: "a", lotId: "lot-41", kgText: "4820" }, { key: "b", lotId: "lot-44", kgText: "1150" }];
  f.streams = [{ key: "c", streamId: "plant-scrap", kgText: "180" }];
  f.logs = [{ key: "d", pcsText: "48", lengthText: "12", billetLengthText: "", kgText: "5860" }];
  f.drossKg = "96";
  f.feKg = "18";
  f.ldo = { start: "42", chargingStart: "", chargingEnd: "", castingStart: "", end: "37" };
  f.chemicals = [{ key: "e", storeItemId: "flux", name: "", unit: "", openText: "40", usedText: "12", closeText: "" }];
  return f;
}

describe("units", () => {
  test("kg to grams, blank and negative are null", () => {
    expect(kgToG("4820")).toBe(4_820_000);
    expect(kgToG("12.5")).toBe(12_500);
    expect(kgToG("")).toBeNull();
    expect(kgToG("-3")).toBeNull();
    expect(kgToG("abc")).toBeNull();
  });
  test("feet to mm and back", () => {
    expect(ftToMm("12")).toBe(3658);
    expect(mmToFtText(3658)).toBe("12");
    expect(ftToMm("0")).toBeNull();
    expect(mmToFtText(null)).toBe("");
  });
  test("LDO inches are tenths; store quantities are thousandths", () => {
    expect(inchToTenth("42.5")).toBe(425);
    expect(tenthToInchText(425)).toBe("42.5");
    expect(qtyToMilli("12.5")).toBe(12_500);
  });
});

describe("figuresOf (the preview; the server stores its own)", () => {
  test("worked example: 6,150 kg in, 5,860 logs, 96 dross, 18 Fe -> burn 176 kg, 2.9 %, yield 95.3 %", () => {
    const f = figuresOf(filled(), 6_000_000 * 2);
    expect(f.balance.metalInG).toBe(6_150_000);
    expect(f.balance.burnG).toBe(6_150_000 - 5_860_000 - 96_000 - 18_000);
    expect(f.balance.balanceBp).toBe(286);
    expect(f.balance.yieldBp).toBe(9528);
    expect(f.balance.needsReason).toBe(false);
  });
  test("over the furnace's capacity", () => {
    expect(figuresOf(filled(), 6_000_000).load).toBe("over");
    expect(figuresOf(filled(), 6_300_000).load).toBe("near");
    expect(figuresOf(filled(), null).load).toBeNull();
  });
  test("burn outside 3 % needs a reason", () => {
    const f = filled();
    f.drossKg = "0";
    f.feKg = "0";
    expect(figuresOf(f, null).balance.needsReason).toBe(true);
  });
  test("a typed kg that is not a number is flagged and counts 0", () => {
    const f = filled();
    f.drossKg = "9x";
    const fig = figuresOf(f, null);
    expect(fig.badKg).toBe(true);
    expect(fig.drossG).toBe(0);
  });
});

describe("saveInputOf", () => {
  test("a full sheet becomes grams, instants, tenths and milli; close is open minus used", () => {
    const r = saveInputOf(filled(), { ...ctx, meltId: "m1", expectedServerSeq: 4, clientRequestId: "req-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const i = r.input;
    expect(i.meltId).toBe("m1");
    expect(i.expectedServerSeq).toBe(4);
    expect(i.furnaceId).toBe("furnace-1");
    expect(i.alloyId).toBeNull();
    expect(i.inputs).toEqual([
      { kind: "lot", ref: "lot-41", kgG: 4_820_000 },
      { kind: "lot", ref: "lot-44", kgG: 1_150_000 },
      { kind: "return_stream", ref: "plant-scrap", kgG: 180_000 },
    ]);
    expect(i.logs).toEqual([{ pcs: 48, lengthMm: 3658, kgG: 5_860_000 }]);
    expect(i.drossG).toBe(96_000);
    expect(i.feG).toBe(18_000);
    expect(i.ldoTenthIn).toEqual({ start: 420, chargingStart: null, chargingEnd: null, castingStart: null, end: 370 });
    expect(i.chemicals).toEqual([{ storeItemId: "flux", openMilli: 40_000, usedMilli: 12_000, closeMilli: 28_000 }]);
    expect(i.times.chargingStart).toBe(Date.UTC(2026, 9, 24, 1, 40));
    expect(i.clientRequestId).toBe("req-1");
  });

  test("it never carries a computed figure the server owns", () => {
    const r = saveInputOf(filled(), ctx);
    if (!r.ok) throw new Error("should save");
    for (const k of ["yieldBp", "burnG", "balanceBp", "inputG", "logsG", "verdict", "loss_bp", "gates"]) expect(Object.keys(r.input)).not.toContain(k);
  });

  test("an empty draft saves (a draft may be blank), with no lines", () => {
    const r = saveInputOf(blankForm("2026-10-24"), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.inputs).toEqual([]);
      expect(r.input.furnaceId).toBeNull();
      expect(r.input.drossG).toBe(0);
    }
  });

  test("a half-written line is an issue on its step and line", () => {
    const f = filled();
    f.lots[1] = { key: "b", lotId: "", kgText: "10" };
    expect(saveInputOf(f, ctx)).toEqual({ ok: false, issue: { code: "lot", step: "charge", line: 1 } });
    const g = filled();
    g.lots[0]!.kgText = "";
    expect(saveInputOf(g, ctx)).toEqual({ ok: false, issue: { code: "kg", step: "charge", line: 0 } });
    const h = filled();
    h.logs[0]!.pcsText = "";
    expect(saveInputOf(h, ctx)).toEqual({ ok: false, issue: { code: "log", step: "output", line: 0 } });
  });

  test("the same lot twice is refused before the server says so", () => {
    const f = filled();
    f.lots.push({ key: "z", lotId: "lot-41", kgText: "10" });
    expect(saveInputOf(f, ctx)).toEqual({ ok: false, issue: { code: "duplicateLot", step: "charge", line: 2 } });
  });

  test("a line above 100 t, a bad time and a chemical that does not add up", () => {
    const f = filled();
    f.lots[0]!.kgText = "100001";
    expect(saveInputOf(f, ctx)).toMatchObject({ ok: false, issue: { code: "kgTooLarge" } });
    const g = filled();
    g.times.castingEnd = "7:70";
    expect(saveInputOf(g, ctx)).toEqual({ ok: false, issue: { code: "time", step: "times" } });
    const h = filled();
    h.chemicals[0]!.closeText = "30";
    expect(saveInputOf(h, ctx)).toEqual({ ok: false, issue: { code: "chemicalClose", step: "chemicals", line: 0 } });
    const i = filled();
    i.chemicals[0]!.openText = "";
    expect(saveInputOf(i, ctx)).toEqual({ ok: false, issue: { code: "chemical", step: "chemicals", line: 0 } });
  });

  test("a chemical that is not in the store needs a name and a unit", () => {
    const f = filled();
    f.chemicals = [{ key: "q", storeItemId: "", name: "Cover flux", unit: "kg", openText: "5", usedText: "2", closeText: "" }];
    const r = saveInputOf(f, ctx);
    expect(r.ok && r.input.chemicals[0]).toEqual({ name: "Cover flux", unit: "kg", openMilli: 5000, usedMilli: 2000, closeMilli: 3000 });
    f.chemicals[0]!.unit = "";
    expect(saveInputOf(f, ctx)).toMatchObject({ ok: false, issue: { code: "chemical" } });
  });

  test("a melt that crosses midnight lands on the next day", () => {
    const f = filled();
    f.times = { preheatStart: "18:00", chargingStart: "20:15", chargingEnd: "22:40", castingStart: "23:30", castingEnd: "02:10" };
    const r = saveInputOf(f, ctx);
    if (!r.ok) throw new Error("should save");
    expect(r.input.times.castingEnd).toBe(Date.UTC(2026, 9, 24, 20, 40));
  });

  test("blank reasons are left out so the server's gate speaks", () => {
    const r = saveInputOf({ ...filled(), balanceNote: "  ", spectroReason: "" }, ctx);
    if (!r.ok) throw new Error("should save");
    expect(r.input.balanceNote).toBeUndefined();
    expect(r.input.spectroReason).toBeUndefined();
  });
});

describe("formFromMelt", () => {
  const saved: SavedMelt = {
    furnaceId: "f1",
    alloyId: null,
    alloyReason: null,
    preheatStartAt: "2026-10-24T00:30:00.000Z",
    chargingStartAt: "2026-10-24T01:40:00.000Z",
    chargingEndAt: null,
    castingStartAt: null,
    castingEndAt: "2026-10-24T11:35:00.000Z",
    ldoStartTenthIn: 420,
    ldoChargingStartTenthIn: null,
    ldoChargingEndTenthIn: null,
    ldoCastingStartTenthIn: null,
    ldoEndTenthIn: 370,
    drossG: 96_000,
    feG: 0,
    balanceNote: null,
    spectroReason: "Spectro pending",
    notes: null,
    inputs: [
      { kind: "lot", lotId: "lot-41", returnStreamId: null, kgG: 4_820_000 },
      { kind: "return_stream", lotId: null, returnStreamId: "ps", kgG: 180_000 },
    ],
    outputs: [{ kind: "logs", returnStreamId: null, pcs: 48, lengthMm: 3658, billetLengthMm: 3658, kgG: 5_860_000 }],
    chemicals: [{ storeItemId: "flux", name: null, unit: null, openMilli: 40_000, usedMilli: 12_000, closeMilli: 28_000 }],
  };

  test("reads times back on the plant clock, blanks stay blank", () => {
    const f = formFromMelt(saved, IST, "2026-10-25");
    expect(f.date).toBe("2026-10-24");
    expect(f.times).toEqual({ preheatStart: "06:00", chargingStart: "07:10", chargingEnd: "", castingStart: "", castingEnd: "17:05" });
    expect(f.ldo.start).toBe("42");
    expect(f.ldo.end).toBe("37");
    expect(f.lots[0]).toMatchObject({ lotId: "lot-41", kgText: "4820" });
    expect(f.streams[0]).toMatchObject({ streamId: "ps", kgText: "180" });
    expect(f.logs[0]).toMatchObject({ pcsText: "48", lengthText: "12", billetLengthText: "", kgText: "5860" });
    expect(f.drossKg).toBe("96");
    expect(f.feKg).toBe("");
    expect(f.spectroReason).toBe("Spectro pending");
    expect(f.chemicals[0]).toMatchObject({ storeItemId: "flux", openText: "40", usedText: "12", closeText: "28" });
  });

  test("a form read back and sent again is the same save", () => {
    const f = formFromMelt(saved, IST, "2026-10-25");
    const a = saveInputOf(f, { ...ctx, meltId: "m" });
    const b = saveInputOf(formFromMelt(saved, IST, "2026-10-25"), { ...ctx, meltId: "m" });
    expect(a).toEqual(b);
    expect(sameForm(f, formFromMelt(saved, IST, "2026-10-25"))).toBe(true);
  });

  test("no time written yet: the date falls back to today's", () => {
    const f = formFromMelt({ ...saved, preheatStartAt: null, chargingStartAt: null, castingEndAt: null }, IST, "2026-10-25");
    expect(f.date).toBe("2026-10-25");
  });

  test("line keys are unique", () => {
    expect(new Set([lineKey(), lineKey(), lineKey()]).size).toBe(3);
  });
});

describe("the phone's copies of the web's form and times files (review m-5)", () => {
  // AGENTS.md says these are shared with the web; they are copies, so a change on one side must reach the other.
  test("melt-form.ts and melt-times.ts are byte-identical to the web's", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const here = join(import.meta.dir, "..");
    for (const f of ["melt-form.ts", "melt-times.ts"]) {
      const phone = readFileSync(join(here, "features/foundry", f), "utf8");
      const web = readFileSync(join(here, "..", "web/src/features/foundry", f), "utf8");
      expect({ f, same: phone === web }).toEqual({ f, same: true });
    }
  });
});
