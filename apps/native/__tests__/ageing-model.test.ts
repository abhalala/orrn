import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Me } from "@orrn/server/lib/permissions";

import {
  ageingModuleOn,
  ageingTile,
  batchByOven,
  batchByTrolley,
  batchWebPath,
  canAddReading,
  canDiscardRow,
  canHoldRow,
  canLoad,
  canRequestOverride,
  canRework,
  canUnholdRow,
  gasFromText,
  gasText,
  hardnessNoteTone,
  hardnessReadings,
  hardnessTone,
  holdLanded,
  loadBody,
  loadTotals,
  nextAction,
  nextActionPermission,
  phaseTone,
  pickOf,
  pressRowsOf,
  previewMedianX10,
  rowsToTest,
  showsAgeing,
  soakProgress,
  soakTone,
  sparkline,
  stageIndex,
  startDefaults,
  unholdLanded,
  voidPermission,
  webOnlyActions,
  wholeFromText,
  x10FromText,
  x10Text,
} from "../features/ageing/model";
import { createAttempt } from "../features/ageing/attempt";
import { moreRows } from "../features/more/more-rows";
import { replayKey } from "../lib/replay-key";

/**
 * FP-AG-16 (W3-AG-N): the pure rules of the ageing station on the phone. The functions the web also has are the
 * web's, compared by source below; the rest (who sees Ageing, the Today tile, the web-only list, the start sheet's
 * defaults) are the phone's own.
 */

function me(role: NonNullable<Me["company"]>["role"], modules: string[] = []): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  };
}

type Row = Parameters<typeof canHoldRow>[1];
const row = (over: Partial<Row> = {}): Row => ({ id: "r1", status: "pending", source: "press", packedPcs: 0, remainingPcs: 10, scrapPcs: 0, reworkPcs: 0, hardnessReadingX10: null, hardnessPass: null, ...over }) as Row;

describe("typed numbers", () => {
  test("temperature and hardness are x10 integers with one decimal at most", () => {
    expect(x10Text(1850)).toBe("185.0");
    expect(x10Text(null)).toBe("-");
    expect(x10FromText("185")).toBe(1850);
    expect(x10FromText("185.5")).toBe(1855);
    expect(x10FromText("185.55")).toBeNull();
    expect(x10FromText("")).toBeNull();
    expect(x10FromText("abc")).toBeNull();
  });

  test("the gas meter is in thousandths", () => {
    expect(gasFromText("1209.350")).toBe(1209350);
    expect(gasFromText("0")).toBe(0);
    expect(gasFromText("1.2345")).toBeNull();
    expect(gasFromText("")).toBeNull();
    expect(gasText(1209350)).toBe("1209.350");
  });

  test("whole numbers", () => {
    expect(wholeFromText("12")).toBe(12);
    expect(wholeFromText("1.5")).toBeNull();
    expect(wholeFromText("")).toBeNull();
  });

  test("hardness samples: any bad filled field, or none filled, is no request; the median preview is the server's rounding", () => {
    expect(hardnessReadings(["", "", ""])).toBeNull();
    expect(hardnessReadings(["62.5", "x", ""])).toBeNull();
    expect(hardnessReadings(["62.5", "63", ""])).toEqual([625, 630]);
    expect(previewMedianX10([630, 625, 640])).toBe(630);
    expect(previewMedianX10([625, 630])).toBe(628);
    expect(previewMedianX10([])).toBeNull();
  });
});

describe("tones", () => {
  test("a sample of the other method (pass null) is neutral, never a failure", () => {
    expect(hardnessTone(null)).toBe("neutral");
    expect(hardnessTone(true)).toBe("green");
    expect(hardnessTone(false)).toBe("red");
  });

  test("phases and the soak verdict", () => {
    expect(phaseTone("soaking")).toBe("amber");
    expect(phaseTone("out")).toBe("blue");
    expect(phaseTone("held")).toBe("red");
    expect(soakTone("ok")).toBe("green");
    expect(soakTone("no_readings")).toBe("neutral");
    expect(soakTone("under_aged")).toBe("red");
    expect(soakTone("over_aged")).toBe("red");
  });
});

describe("the stage stepper and the one next action", () => {
  const b = (status: string, rows: Row[] = [row()], extra: Record<string, unknown> = {}) => ({ status, rows, overrideApprovalId: null, ...extra }) as never;

  test("stage index follows the status; out is the test stage until every line is tested", () => {
    expect(stageIndex(b("loading"))).toBe(0);
    expect(stageIndex(b("in_oven"))).toBe(1);
    expect(stageIndex(b("out"))).toBe(2);
    expect(stageIndex(b("out", [row({ hardnessReadingX10: 620 })]))).toBe(3);
    expect(stageIndex(b("released"))).toBe(4);
    expect(stageIndex(b("held"))).toBe(4);
  });

  test("start needs a line, take out follows the oven, hardness before release", () => {
    expect(nextAction(b("loading", []))).toBe("none");
    expect(nextAction(b("loading"))).toBe("start");
    expect(nextAction(b("in_oven"))).toBe("takeOut");
    expect(nextAction(b("out"))).toBe("hardness");
    expect(nextAction(b("out", [row({ hardnessReadingX10: 620 })]))).toBe("release");
    expect(nextAction(b("released"))).toBe("none");
  });

  test("a held batch releases again only once an approval is stamped on it", () => {
    expect(nextAction(b("held"))).toBe("none");
    expect(nextAction(b("held", [row({ status: "held" })], { overrideApprovalId: "ap1" }))).toBe("release");
  });

  test("who may take the step is the server's action for it", () => {
    expect(nextActionPermission("start")).toBe("ageing.load");
    expect(nextActionPermission("takeOut")).toBe("ageing.load");
    expect(nextActionPermission("hardness")).toBe("ageing.record");
    expect(nextActionPermission("release")).toBe("ageing.release");
    expect(nextActionPermission("none")).toBeNull();
  });

  test("rows still to test are the pending untested ones", () => {
    expect(rowsToTest({ rows: [row(), row({ id: "r2", hardnessReadingX10: 600 }), row({ id: "r3", status: "held" })] }).map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("line actions", () => {
  test("hold: a judged batch, a line not packed from, never a whole-bundle row", () => {
    expect(canHoldRow({ status: "out" }, row())).toBe(true);
    expect(canHoldRow({ status: "in_oven" }, row())).toBe(false);
    expect(canHoldRow({ status: "released" }, row({ status: "released", packedPcs: 2 }))).toBe(false);
    expect(canHoldRow({ status: "released" }, row({ source: "bundle" }))).toBe(false);
    expect(canUnholdRow(row({ status: "held" }))).toBe(true);
    expect(canUnholdRow(row())).toBe(false);
  });

  test("approval: a held or out batch with a held line, nothing pending, nothing approved", () => {
    expect(canRequestOverride({ status: "held", overrideApprovalId: null, pendingOverrideId: null }, true)).toBe(true);
    expect(canRequestOverride({ status: "held", overrideApprovalId: null, pendingOverrideId: "p" }, true)).toBe(false);
    expect(canRequestOverride({ status: "held", overrideApprovalId: "a", pendingOverrideId: null }, true)).toBe(false);
    expect(canRequestOverride({ status: "held", overrideApprovalId: null, pendingOverrideId: null }, false)).toBe(false);
  });

  test("a reading is open in the oven and for 30 minutes after take-out", () => {
    const t0 = 1_700_000_000_000;
    expect(canAddReading({ status: "in_oven", outAt: null }, t0)).toBe(true);
    expect(canAddReading({ status: "out", outAt: t0 - 10 * 60_000 }, t0)).toBe(true);
    expect(canAddReading({ status: "out", outAt: t0 - 31 * 60_000 }, t0)).toBe(false);
    expect(canAddReading({ status: "loading", outAt: null }, t0)).toBe(false);
  });

  test("rework, discard and void are the web's: the phone lists which apply and nothing else", () => {
    const held = { status: "held", rows: [row({ status: "held", remainingPcs: 5 })], successorBatchId: null, reworkOfBatchId: null, overrideApprovalId: null, pendingOverrideId: null, qcVerdict: "fail" } as never;
    expect(webOnlyActions(held)).toEqual(["rework", "discard", "void"]);
    const inOven = { status: "in_oven", rows: [row()], successorBatchId: null, reworkOfBatchId: null, overrideApprovalId: null, pendingOverrideId: null, qcVerdict: null } as never;
    expect(webOnlyActions(inOven)).toEqual([]);
    const loading = { ...(inOven as object), status: "loading" } as never;
    expect(webOnlyActions(loading)).toEqual(["void"]);
    expect(voidPermission({ status: "loading", reworkOfBatchId: "x" })).toBe("ageing.release");
    expect(canRework({ status: "held", rows: [row({ status: "held" })], successorBatchId: "s" })).toBe(false);
    expect(canDiscardRow({ status: "released" }, row({ status: "released", remainingPcs: 0 }))).toBe(false);
  });

  test("the web page of a batch", () => {
    expect(batchWebPath("b1")).toBe("/ageing/batch/b1");
  });
});

describe("the load picker", () => {
  const lines = [
    { pressRunLineId: "l1", pcsLeft: 40, kgLeftG: 80_000 },
    { pressRunLineId: "l2", pcsLeft: 10, kgLeftG: 30_000 },
  ];

  test("a pick is a whole number up to what is left; blank is nothing", () => {
    expect(pickOf(undefined, lines[0]!)).toEqual({ pcs: 0, error: null });
    expect(pickOf("  ", lines[0]!)).toEqual({ pcs: 0, error: null });
    expect(pickOf("12", lines[0]!)).toEqual({ pcs: 12, error: null });
    expect(pickOf("41", lines[0]!)).toEqual({ pcs: 41, error: "over" });
    expect(pickOf("x", lines[0]!)).toEqual({ pcs: 0, error: "invalid" });
  });

  test("totals prorate kg by the pieces taken (the server's figure stands) and count bundles whole", () => {
    expect(loadTotals(lines, { l1: "40", l2: "5" }, [{ pcs: 6, weightG: 12_000 }])).toEqual({ lines: 3, pcs: 51, kgG: 80_000 + 15_000 + 12_000, problems: 0 });
    expect(loadTotals(lines, { l1: "41" }, []).problems).toBe(1);
  });

  test("load needs a trolley, something picked and nothing wrong; rows go as pieces, never kg", () => {
    expect(canLoad(loadTotals(lines, { l1: "5" }, []), "t1")).toBe(true);
    expect(canLoad(loadTotals(lines, { l1: "5" }, []), null)).toBe(false);
    expect(canLoad(loadTotals(lines, {}, []), "t1")).toBe(false);
    expect(canLoad(loadTotals(lines, { l1: "99" }, []), "t1")).toBe(false);
    expect(pressRowsOf(lines, { l1: "5", l2: "" })).toEqual([{ pressRunLineId: "l1", pcs: 5 }]);
  });
});

describe("board grouping and the soak clock", () => {
  const batches = [
    { id: "a", status: "in_oven", ovenId: "o1", trolleyId: "t1" },
    { id: "b", status: "out", ovenId: null, trolleyId: "t2" },
    { id: "c", status: "closed", ovenId: null, trolleyId: "t3" },
  ] as never[];
  test("the oven's batch is the one in the oven; a trolley carries any unfinished batch", () => {
    expect([...batchByOven(batches).keys()]).toEqual(["o1"]);
    expect([...batchByTrolley(batches).keys()]).toEqual(["t1", "t2"]);
  });
  test("soak progress is elapsed against the recipe, capped at full", () => {
    expect(soakProgress(null, 240, 0)).toBeNull();
    expect(soakProgress(0, 240, 120 * 60_000)).toEqual({ elapsedMin: 120, ratio: 0.5 });
    expect(soakProgress(0, 240, 600 * 60_000)?.ratio).toBe(1);
  });
  test("the sparkline draws inside its box and keeps the last reading as the dot", () => {
    const s = sparkline([{ at: 0, tempCX10: 1800 }, { at: 60_000, tempCX10: 1850 }], { width: 200, height: 60 }, { lowX10: 1830, highX10: 1870 });
    expect(s?.points.split(" ")).toHaveLength(2);
    expect(s?.last).not.toBeNull();
    expect(sparkline([], { width: 200, height: 60 }, null)).toBeNull();
  });
});

describe("who sees Ageing", () => {
  test("view or a floor action opens the station; the module has to be on (an empty list means all on)", () => {
    for (const role of ["owner", "admin", "manager", "supervisor", "press", "operator", "office"] as const) expect(showsAgeing(me(role))).toBe(true);
    for (const role of ["packer", "viewer", "die_room"] as const) expect(showsAgeing(me(role))).toBe(false);
    expect(showsAgeing(me("operator", ["bundles"]))).toBe(false);
    expect(showsAgeing(me("operator", ["Ageing"]))).toBe(true);
    expect(ageingModuleOn(me("owner", []))).toBe(true);
    expect(showsAgeing(null)).toBe(false);
  });

  test("it is a row under More, first, and never a tab", () => {
    const rows = moreRows(me("supervisor")).map((r) => r.key);
    expect(rows[0]).toBe("ageing");
    expect(moreRows(me("operator"))[0]).toMatchObject({ key: "ageing", href: "/more/ageing", labelKey: "nav.ageing" });
    expect(moreRows(me("packer")).map((r) => r.key)).not.toContain("ageing");
    expect(moreRows(me("operator", ["bundles"])).map((r) => r.key)).not.toContain("ageing");
  });
});

describe("Today's tile", () => {
  test("no tile without the server's figures (no ageing.view)", () => {
    expect(ageingTile(null, me("owner"))).toBeNull();
    expect(ageingTile(undefined, me("owner"))).toBeNull();
  });
  test("no tile when the plant's module list leaves ageing out (the server sends 0/0/0 then)", () => {
    const zero = { inOven: 0, out: 0, held: 0 };
    expect(ageingTile(zero, me("owner", ["bundles"]))).toBeNull();
    expect(ageingTile(zero, me("owner", ["Ageing"]))?.tone).toBe("neutral");
    expect(ageingTile(zero, me("owner", []))?.tone).toBe("neutral");
    // No profile yet is an unknown module list, which reads as "all on" (ageingModuleOn); the tile still needs the server's figures.
    expect(ageingTile(zero, null)?.tone).toBe("neutral");
    expect(ageingTile(null, null)).toBeNull();
  });
  test("held turns it red, pieces waiting for the test blue, a cycle running amber", () => {
    expect(ageingTile({ inOven: 2, out: 1, held: 1 }, me("owner"))?.tone).toBe("red");
    expect(ageingTile({ inOven: 2, out: 1, held: 0 }, me("owner"))?.tone).toBe("blue");
    expect(ageingTile({ inOven: 2, out: 0, held: 0 }, me("owner"))?.tone).toBe("amber");
    expect(ageingTile({ inOven: 0, out: 0, held: 0 }, me("owner"))?.tone).toBe("neutral");
  });
});

describe("the start sheet's defaults", () => {
  const ovens = [
    { id: "o1", status: "active", busyBatchId: "b9" },
    { id: "o2", status: "active", busyBatchId: null },
    { id: "o3", status: "out_of_service", busyBatchId: null },
  ];
  const recipes = [
    { id: "r1", status: "active", kind: "full", alloy: "6063", temper: "T6" },
    { id: "r2", status: "active", kind: "full", alloy: "6063", temper: "T5" },
    { id: "r3", status: "active", kind: "top_up", alloy: "6063", temper: "T5" },
    { id: "r4", status: "archived", kind: "full", alloy: "6063", temper: "T5" },
  ];
  const shifts = [{ id: "s1" }, { id: "s2" }];

  test("the first free oven, the plant's current shift and the recipe of its default alloy and temper", () => {
    expect(startDefaults({ ovens, recipes, shifts, settings: { defaultAlloy: "6063", defaultTemper: "T5", currentShiftId: "s2" }, current: {}, topUp: false })).toEqual({ ovenId: "o2", recipeId: "r2", shiftId: "s2" });
  });
  test("a batch that is aged again takes the top-up recipe", () => {
    expect(startDefaults({ ovens, recipes, shifts, settings: { defaultAlloy: "6063", defaultTemper: "T5" }, current: {}, topUp: true }).recipeId).toBe("r3");
  });
  test("what the person picked stays while it is still valid; a busy oven is dropped", () => {
    const pick = startDefaults({ ovens, recipes, shifts, settings: { defaultAlloy: "6063", defaultTemper: "T5" }, current: { ovenId: "o1", recipeId: "r1", shiftId: "s1" }, topUp: false });
    expect(pick).toEqual({ ovenId: "o2", recipeId: "r1", shiftId: "s1" });
  });
  test("with no settings yet the recipe waits (the plant's default decides it)", () => {
    expect(startDefaults({ ovens, recipes, shifts, settings: undefined, current: {}, topUp: false }).recipeId).toBe("");
  });
});

describe("the web's own arithmetic is the phone's", () => {
  test("the shared pure functions are the same source as apps/web/src/features/ageing/model.ts", async () => {
    const web = (await import(join(import.meta.dir, "..", "..", "web", "src", "features", "ageing", "model.ts"))) as Record<string, unknown>;
    const native = await import("../features/ageing/model");
    const shared = [
      "x10Text", "x10FromText", "wholeFromText", "gasText", "gasFromText", "minutesParts", "phaseTone", "rowTone", "soakTone", "capacityTone",
      "rowsToTest", "stageIndex", "nextAction", "nextActionPermission", "soakProgress", "sparkline", "lineKgG", "pickOf", "loadTotals", "canLoad", "pressRowsOf",
      "hardnessReadings", "previewMedianX10", "canHoldRow", "canUnholdRow", "canRework", "canDiscardRow", "canRequestOverride", "voidPermission", "batchByOven", "batchByTrolley",
    ];
    for (const name of shared) {
      expect(typeof web[name]).toBe("function");
      expect({ name, same: String((native as Record<string, unknown>)[name]) === String(web[name]) }).toEqual({ name, same: true });
    }
    expect(native.STAGES).toEqual(web.STAGES as never);
    expect(native.STAGE_KEYS).toEqual(web.STAGE_KEYS as never);
  });
});

describe("review round 1: the load key (I-1)", () => {
  const lines = [
    { pressRunLineId: "l1", pcsLeft: 40, kgLeftG: 80_000 },
    { pressRunLineId: "l2", pcsLeft: 10, kgLeftG: 30_000 },
  ];
  const b = [{ bundleId: "b1" }];

  test("the body never carries a batchId: the server adds to the trolley's loading batch", () => {
    const body = loadBody("t1", lines, { l1: "20" }, b);
    expect(body).toEqual({ trolleyId: "t1", rows: [{ pressRunLineId: "l1", pcs: 20 }], bundles: [{ bundleId: "b1" }], manual: [] });
    expect("batchId" in body).toBe(false);
  });

  test("unsure, then the re-read gives the trolley an open batch: the second tap reuses the SAME key (no double load)", () => {
    let n = 0;
    const fresh = () => `k${(n += 1)}`;
    const attempt = createAttempt(fresh);
    // First tap: a partial pick on a free trolley.
    const first = attempt.key(loadBody("t1", lines, { l1: "20" }, []));
    // The reply is lost. The re-read refreshes the trolley list (openBatchId appears) and the line (still 20 left of 40): the pick is still valid.
    const second = attempt.key(loadBody("t1", lines, { l1: "20" }, []));
    expect(second).toBe(first);
    expect(n).toBe(1);
  });

  test("an edited pick is another write with another key; putting it back sends the first key again", () => {
    let n = 0;
    const attempt = createAttempt(() => `k${(n += 1)}`);
    const a = attempt.key(loadBody("t1", lines, { l1: "20" }, []));
    const other = attempt.key(loadBody("t1", lines, { l1: "10" }, []));
    expect(other).not.toBe(a);
    expect(attempt.key(loadBody("t1", lines, { l1: "20" }, []))).toBe(a);
  });

  test("a saved load ends the attempt: the next load is a new key", () => {
    let n = 0;
    const attempt = createAttempt(() => `k${(n += 1)}`);
    const a = attempt.key(loadBody("t1", lines, { l1: "20" }, []));
    attempt.saved();
    expect(attempt.key(loadBody("t1", lines, { l1: "20" }, []))).not.toBe(a);
  });

  test("the load screen sends loadBody and nothing of its own", () => {
    const src = readFileSync(join(import.meta.dir, "..", "features", "ageing", "load-view.tsx"), "utf8");
    expect(src).toContain("loadBody(trolleyId, lineItems, picks, pickedBundles)");
    expect(src).not.toMatch(/batchId:/);
    expect(src).not.toMatch(/openBatchId \? \{ batchId/);
  });
});

describe("review round 1: a key belongs to one opening of a sheet (I-2)", () => {
  test("replayKey alone would swallow the next same-value reading after an unsure one; forget() makes it a new reading", () => {
    // The old behaviour, shown on replayKey itself: an unsure attempt stays, the same content gets the same id.
    const body = { batchId: "b1", tempCX10: 1850 };
    const kept = replayKey(null, body, () => "k1");
    expect(replayKey(kept.attempt, body, () => "k2").id).toBe("k1");
    // The fix: the sheet forgets the attempt when it opens.
    let n = 0;
    const attempt = createAttempt(() => `k${(n += 1)}`);
    const first = attempt.key(body);
    attempt.forget();
    expect(attempt.key(body)).not.toBe(first);
  });

  test("an unsure send, with no forget, keeps its key for the second tap of the SAME opening", () => {
    let n = 0;
    const attempt = createAttempt(() => `k${(n += 1)}`);
    const body = { batchId: "b1", tempCX10: 1850 };
    expect(attempt.key(body)).toBe(attempt.key(body));
  });

  test("a same-value reading after a saved one is a new reading", () => {
    let n = 0;
    const attempt = createAttempt(() => `k${(n += 1)}`);
    const body = { batchId: "b1", tempCX10: 1850 };
    const first = attempt.key(body);
    attempt.saved();
    expect(attempt.key(body)).not.toBe(first);
  });

  test("every sheet forgets its key in the effect that runs when it opens; the hook offers forget()", () => {
    const dir = join(import.meta.dir, "..", "features", "ageing");
    const hook = readFileSync(join(dir, "use-ageing.ts"), "utf8");
    expect(hook).toMatch(/const forget = useCallback\(\(\) => attempt\.forget\(\), \[attempt\]\)/);
    expect(hook).toMatch(/return \{ \.\.\.state, run, reset, forget \}/);
    const sheets = readFileSync(join(dir, "sheets.tsx"), "utf8");
    // Start, Take out, Temperature, Hardness: each has a keyed write and each resets it on open.
    expect((sheets.match(/useKeyedWrite\(refresh\)/g) ?? []).length).toBe(4);
    expect((sheets.match(/write\.forget\(\);/g) ?? []).length).toBe(4);
    for (const name of ["StartSheet", "TakeOutSheet", "TempSheet", "HardnessSheet"]) {
      const from = sheets.indexOf(`export function ${name}`);
      const next = sheets.indexOf("\nexport function ", from + 10);
      const body = sheets.slice(from, next === -1 ? undefined : next);
      expect({ name, forgets: /write\.forget\(\);/.test(body) && /write\.reset\(\);/.test(body) }).toEqual({ name, forgets: true });
    }
  });
});

describe("review round 1: the sheets that closed on a landed answer (m-2)", () => {
  const rows = (...statuses: string[]) => statuses.map((status, i) => row({ id: `r${i + 1}`, status: status as never }));
  test("a line hold landed when the line reads held; not before", () => {
    expect(holdLanded({ rows: rows("pending", "held") }, "r2")).toBe(true);
    expect(holdLanded({ rows: rows("pending", "held") }, "r1")).toBe(false);
    expect(holdLanded({ rows: rows("pending") }, "gone")).toBe(false);
  });
  test("a whole-trolley hold landed when no live line is left unheld (void and closed lines do not count)", () => {
    expect(holdLanded({ rows: rows("held", "held", "void") }, null)).toBe(true);
    expect(holdLanded({ rows: rows("held", "pending") }, null)).toBe(false);
    expect(holdLanded({ rows: rows("held", "released") }, null)).toBe(false);
    expect(holdLanded({ rows: rows("void", "closed") }, null)).toBe(false);
  });
  test("a clear landed when the line no longer reads held (or is gone)", () => {
    expect(unholdLanded({ rows: rows("pending") }, "r1")).toBe(true);
    expect(unholdLanded({ rows: rows("held") }, "r1")).toBe(false);
    expect(unholdLanded({ rows: rows("held") }, "gone")).toBe(true);
  });
});

describe("review round 1: small things", () => {
  test("the hardness note is neutral for a sample of the other method (pass null), never green", () => {
    expect(hardnessNoteTone(null)).toBe("neutral");
    expect(hardnessNoteTone(true)).toBe("green");
    expect(hardnessNoteTone(false)).toBe("red");
  });
});
