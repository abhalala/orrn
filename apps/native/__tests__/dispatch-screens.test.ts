import { describe, expect, test } from "bun:test";

import { dispatchNow } from "../features/dispatch/dispatch-now";
import { dispatchTotals, groupItems } from "../features/dispatch/group-items";
import { overRaceAfterComplete } from "../features/dispatch/capacity";
import { barActions, currentStep, nextStep, showsActionBar, stepPerms } from "../features/dispatch/next-step";
import { plTable, toPlSnapshot } from "../features/dispatch/packing-list";
import { resolvePasted } from "../features/dispatch/paste";
import { customerDispatchDay, shipDateFromChoice, shipDayLine } from "../features/dispatch/ship-date";
import { formatDay as formatDayAt, monthNames } from "../lib/format";
import type { ResolveHit } from "../features/scan/scan-flow";

const item = (over: Record<string, unknown>) => ({
  itemId: "i",
  bundleId: "b",
  serial: "S",
  status: "reserved",
  quantity: 10,
  weightG: 50_000,
  lengthMm: 3658,
  groupId: "g",
  groupLabel: null as string | null,
  dieId: "d1",
  dieSeries: "PATTI",
  dieSectionCode: "14701",
  ...over,
});

describe("void bundles never count", () => {
  const items = [item({ itemId: "1", serial: "26J2" }), item({ itemId: "2", serial: "26J3", status: "void", weightG: 999_000, quantity: 99 })];
  test("totals and groups skip a void bundle", () => {
    expect(dispatchTotals(items)).toEqual({ bundles: 1, weightG: 50_000, pieces: 10 });
    const groups = groupItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.bundles.map((b) => b.serial)).toEqual(["26J2"]);
  });

  test("bundles inside a group sort in packing order", () => {
    const groups = groupItems([item({ itemId: "1", serial: "26J10" }), item({ itemId: "2", serial: "26J2" })]);
    expect(groups[0]!.bundles.map((b) => b.serial)).toEqual(["26J2", "26J10"]);
  });

  test("two labelled groups sort by label", () => {
    const groups = groupItems([item({ itemId: "1", groupLabel: "B" }), item({ itemId: "2", groupLabel: "A" })]);
    expect(groups.map((g) => g.label)).toEqual(["A", "B"]);
  });
});

describe("dispatch now", () => {
  test("a hold that already went through is not repeated", async () => {
    const calls: string[] = [];
    await dispatchNow("draft", { held: true }, { reserve: async () => void calls.push("reserve"), complete: async () => void calls.push("complete") });
    expect(calls).toEqual(["complete"]);
  });

  test("a failed hold stops before complete", async () => {
    const calls: string[] = [];
    const state = { held: false };
    await expect(
      dispatchNow("draft", state, {
        reserve: async () => {
          throw new Error("no stock");
        },
        complete: async () => void calls.push("complete"),
      }),
    ).rejects.toThrow("no stock");
    expect(calls).toEqual([]);
    expect(state.held).toBe(false);
  });

  test("cancelled refuses", async () => {
    await expect(dispatchNow("cancelled", { held: false }, { reserve: async () => {}, complete: async () => {} })).rejects.toThrow();
  });
});

describe("ship date edge cases", () => {
  const now = new Date(2026, 9, 6, 12);
  test("empty typed text is not a day", () => {
    expect(shipDateFromChoice({ kind: "typed", text: "" }, now)).toBeUndefined();
    expect(shipDateFromChoice({ kind: "typed", text: "  05-11-2026 " }, now)).toBe(Date.UTC(2026, 10, 5));
  });
  test("tomorrow rolls over the month end", () => {
    expect(shipDateFromChoice({ kind: "tomorrow" }, new Date(2026, 9, 31, 9))).toBe(Date.UTC(2026, 10, 1));
  });
});

describe("pasted old codes are resolved before the add", () => {
  const hits: Record<string, ResolveHit> = {
    J540: { kind: "bundle", number: "26J540" },
    J541: { kind: "ambiguous", candidates: [{ bundleId: "a", number: "25J541", year: 2025 }, { bundleId: "b", number: "26J541", year: 2026 }] },
    J999: { kind: "not_found" },
  };
  test("plant numbers go straight through; old codes become the bundle number", async () => {
    const asked: string[] = [];
    const out = await resolvePasted(["26J1", "J540", "J541", "J999", "26J540"], async (code) => {
      asked.push(code);
      return hits[code]!;
    });
    expect(asked).toEqual(["J540", "J541", "J999"]);
    expect(out).toEqual({ serials: ["26J1", "26J540"], notFound: ["J999"], ambiguous: ["J541"] });
  });
});

describe("packing list snapshot from the API", () => {
  const raw = {
    dispatch: { code: "D-0007", customer: { id: "c", name: "Surat Aluminium", phone: "98" }, shipDate: "2026-10-07T00:00:00.000Z", notes: "", status: "completed", completedAt: "2026-10-07T05:00:00.000Z" },
    company: { id: "co", name: "FourCubes" },
    items: [
      { bundleSerial: "26J10", die: { series: "PATTI", sectionCode: "14701" }, groupId: "g", quantity: 10, weightG: 50_000, lengthMm: 3658 },
      { bundleSerial: "26J2", die: { series: "PATTI", sectionCode: "14701" }, groupId: "g", quantity: 10, weightG: 52_000, lengthMm: 3658 },
      { bundleSerial: "26K1", die: { series: "ANGLE", sectionCode: "2207" }, groupId: "g", quantity: 0, weightG: 9_000, lengthMm: 3658 },
    ],
    totals: { totalBundles: 3, totalQuantity: 20, totalWeightKg: 111, totalLengthM: 10.974 },
    generatedAt: "2026-10-07T05:00:00.000Z",
  };

  test("maps to the shape the PDF and Excel builders take", () => {
    const pl = toPlSnapshot(raw)!;
    expect(pl.dispatch.code).toBe("D-0007");
    expect(pl.dispatch.customer.name).toBe("Surat Aluminium");
    expect(pl.company.name).toBe("FourCubes");
    expect(pl.items).toHaveLength(3);
    expect(pl.totals.totalWeightKg).toBe(111);
  });

  test("fills what an older server left out, and refuses what is not a packing list", () => {
    const pl = toPlSnapshot({ dispatch: { code: "D-1" }, items: [{ bundleSerial: "A", die: { series: "S", sectionCode: "1" }, quantity: 2, weightG: 4000, lengthMm: 1000 }] })!;
    expect(pl.totals).toEqual({ totalBundles: 1, totalQuantity: 2, totalWeightKg: 4, totalLengthM: 1 });
    expect(pl.dispatch.customer.name).toBe("");
    expect(toPlSnapshot(null)).toBeNull();
    expect(toPlSnapshot({ items: [] })).toBeNull();
  });

  test("table sorts by section then bundle number, numbers Sr, and subtotals each section", () => {
    const table = plTable(toPlSnapshot(raw)!);
    expect(table.sections.map((s) => [s.label, s.rows.map((r) => r.serial), s.weightG, s.pieces])).toEqual([
      ["2207 ANGLE", ["26K1"], 9_000, 0],
      ["14701 PATTI", ["26J2", "26J10"], 102_000, 20],
    ]);
    expect(table.sections.flatMap((s) => s.rows.map((r) => r.sr))).toEqual([1, 2, 3]);
    expect(table.totals).toEqual({ bundles: 3, weightG: 111_000, pieces: 20 });
  });

  test("kg per 12 ft and its band; none without pieces", () => {
    const rows = plTable(toPlSnapshot(raw)!).sections.flatMap((s) => s.rows);
    const patti = rows.find((r) => r.serial === "26J2")!;
    // (52 kg / 10 pcs) / (3658 mm / 304.8) * 12 = 5.199; the band floors with a 0.01 tolerance
    expect(patti.kg12).toBeCloseTo(5.199, 2);
    expect(patti.band).toBe(5.2);
    const angle = rows.find((r) => r.serial === "26K1")!;
    expect(angle.kg12).toBeNull();
    expect(angle.band).toBeNull();
  });
});

describe("the one next step in the bottom bar", () => {
  const all = { addBundle: true, reserve: true, complete: true };
  test("an empty dispatch asks for bundles; nothing is offered once it is over", () => {
    expect(nextStep("draft", 0, all)).toEqual({ primary: "scan", secondary: [] });
    expect(nextStep("draft", 0, { ...all, addBundle: false })).toEqual({ primary: null, secondary: [] });
    expect(nextStep("completed", 3, all).primary).toBeNull();
    expect(nextStep("cancelled", 3, all).primary).toBeNull();
  });

  test("Dispatch is the big button for whoever can complete; Hold and Release sit beside it", () => {
    expect(nextStep("draft", 2, all)).toEqual({ primary: "dispatch", secondary: ["hold"] });
    expect(nextStep("reserved", 2, all)).toEqual({ primary: "dispatch", secondary: ["release"] });
  });

  test("someone who can only hold gets Hold stock; Dispatch from Building also needs the right to hold", () => {
    expect(nextStep("draft", 2, { addBundle: true, reserve: true, complete: false })).toEqual({ primary: "hold", secondary: [] });
    expect(nextStep("draft", 2, { addBundle: true, reserve: false, complete: true })).toEqual({ primary: null, secondary: [] });
    expect(nextStep("reserved", 2, { addBundle: true, reserve: true, complete: false })).toEqual({ primary: null, secondary: ["release"] });
  });

  test("stepper position", () => {
    expect(["draft", "reserved", "completed", "cancelled"].map((s) => currentStep(s as never))).toEqual([0, 1, 3, -1]);
  });
});

describe("bottom action bar visibility (role x status, mirrors the web dispatch screen)", () => {
  const me = (role: string) =>
    ({
      user: { id: "u", name: "Asha", email: "a@x.in" },
      company: { id: "c", name: "Fourcubes", slug: "fc", status: "active", plan: null, role, modules: [] },
      isPlatformAdmin: false,
    }) as never;
  const bar = (role: string, status: "draft" | "reserved" | "completed" | "cancelled", bundles: number) =>
    barActions(nextStep(status, bundles, stepPerms(me(role), status)));

  test("a packer on a held dispatch still sees Release, with no primary button", () => {
    const step = nextStep("reserved", 3, stepPerms(me("packer"), "reserved"));
    expect(step).toEqual({ primary: null, secondary: ["release"] });
    expect(showsActionBar(step)).toBe(true);
    expect(bar("packer", "reserved", 3)).toEqual(["release"]);
  });

  test("a packer keeps Release on an empty held dispatch too (web only disables Dispatch there)", () => {
    expect(bar("packer", "reserved", 0)).toEqual(["release", "scan"]);
    expect(bar("viewer", "reserved", 0)).toEqual([]);
  });

  test("a viewer on a held dispatch gets no bar at all", () => {
    const step = nextStep("reserved", 3, stepPerms(me("viewer"), "reserved"));
    expect(showsActionBar(step)).toBe(false);
    expect(bar("viewer", "reserved", 3)).toEqual([]);
    expect(bar("viewer", "draft", 3)).toEqual([]);
  });

  test("a dispatcher on a held dispatch sees Release and Dispatch", () => {
    expect(bar("supervisor", "reserved", 3)).toEqual(["release", "dispatch"]);
    expect(bar("office", "reserved", 3)).toEqual(["release", "dispatch"]);
  });

  test("building: packer holds, dispatcher holds or dispatches, empty asks for bundles", () => {
    expect(bar("packer", "draft", 3)).toEqual(["hold"]);
    expect(bar("supervisor", "draft", 3)).toEqual(["hold", "dispatch"]);
    expect(bar("packer", "draft", 0)).toEqual(["scan"]);
  });

  test("nothing in the bar once the dispatch is over", () => {
    for (const role of ["packer", "supervisor", "viewer"]) {
      expect(bar(role, "completed", 3)).toEqual([]);
      expect(bar(role, "cancelled", 3)).toEqual([]);
    }
  });
});

describe("complete refused because the load went over while the sheet was open (m-8)", () => {
  const over = { loadedG: 11_000_000, capacityG: 9_000_000, state: "over" as const, fillBp: 12_222, overG: 2_000_000, needsReason: true };
  const ok = { ...over, loadedG: 8_000_000, state: "ok" as const, overG: 0, needsReason: false };
  const refused = { data: { code: "PRECONDITION_FAILED" }, message: "Loaded 11,000 kg is 2,000 kg over the vehicle's 9,000 kg. Give a reason to complete." };

  test("no reason was sent and the fresh read says over: keep the sheet open and ask why", () => {
    expect(overRaceAfterComplete(refused, false, over)).toBe(true);
  });

  test("anything else stays an ordinary failure", () => {
    expect(overRaceAfterComplete(refused, true, over)).toBe(false);
    expect(overRaceAfterComplete(refused, false, ok)).toBe(false);
    expect(overRaceAfterComplete(refused, false, null)).toBe(false);
    expect(overRaceAfterComplete({ data: { code: "BAD_REQUEST" } }, false, over)).toBe(false);
    expect(overRaceAfterComplete(new Error("Network request failed"), false, over)).toBe(false);
  });
});

describe("ship day (review round 1, I1: one rule on the phone, the web and the packing list)", () => {
  const months = monthNames("Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec");
  const day = (v: string | number | Date) => formatDayAt(v, months, new Date("2026-10-30T06:00:00Z"), "Asia/Kolkata");
  const t = (key: string, vars?: { date: string }) => (vars ? `${key}:${vars.date}` : key);

  test("a load that left reads Dispatched <day it left>; one being built reads Ship <entered date>; none says so", () => {
    expect(shipDayLine({ ymd: "2026-10-28", kind: "dispatched" }, day, t as never)).toBe("dispatch.detail.dispatchedOn:28 Oct");
    expect(shipDayLine({ ymd: "2026-10-31", kind: "ship" }, day, t as never)).toBe("dispatch.detail.shipOn:31 Oct");
    expect(shipDayLine(null, day, t as never)).toBe("native.dispatch.noShipDate");
    expect(shipDayLine(undefined, day, t as never)).toBe("native.dispatch.noShipDate");
  });

  test("the customer's list reads the server's ship day, else the day the load was started on the company's clock", () => {
    expect(customerDispatchDay({ shipDay: { ymd: "2026-10-28", kind: "dispatched" }, createdAt: "2026-10-20T05:00:00Z" }, day)).toBe("28 Oct");
    expect(customerDispatchDay({ shipDay: null, createdAt: "2026-10-19T20:00:00Z" }, day)).toBe("20 Oct");
  });
});
