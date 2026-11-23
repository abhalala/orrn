import { describe, expect, test } from "bun:test";

import { dueLines, hoursMinutes, maintErrorKey, maintenanceNamed, maintenanceOn, maintReady, milliText, parseMilli } from "./model";
import { parseWoSearch, woFilterOf } from "./search";

const me = (role: string, modules: string[] = []) =>
  ({ isPlatformAdmin: false, platformRole: null, company: { role, modules } }) as unknown as Parameters<typeof maintReady>[0];

describe("maintenance gate", () => {
  test("maintenance is opt-in (PROD-GATE): off on an empty list, on only when named", () => {
    expect(maintenanceOn(me("operator"))).toBe(false);
    expect(maintenanceOn(me("operator", ["press", "maintenance"]))).toBe(true);
    expect(maintenanceOn(me("operator", ["press"]))).toBe(false);
  });
  test("maintReady needs the action and the module", () => {
    const on = ["maintenance"];
    expect(maintReady(me("operator"), ["maint.workorder"])).toBe(false);
    expect(maintReady(me("operator", on), ["maint.workorder"])).toBe(true);
    expect(maintReady(me("operator", ["press"]), ["maint.workorder"])).toBe(false);
    expect(maintReady(me("storekeeper", on), ["maint.workorder", "maint.manage"])).toBe(false);
    expect(maintReady(me("storekeeper", on), ["maint.view"])).toBe(true);
    expect(maintReady(me("accountant", on), ["maint.view"])).toBe(false);
    expect(maintReady(null, ["maint.view"])).toBe(false);
  });
});

describe("maintenance named (load errors on shared screens)", () => {
  test("only a module list that names maintenance; empty (all on) does not", () => {
    expect(maintenanceNamed({ company: { modules: [] } } as never)).toBe(false);
    expect(maintenanceNamed({ company: { modules: ["press"] } } as never)).toBe(false);
    expect(maintenanceNamed({ company: { modules: ["press", "Maintenance"] } } as never)).toBe(true);
    expect(maintenanceNamed(null as never)).toBe(false);
  });
  test("the new refusal maps to its words", () => {
    expect(maintErrorKey({ message: "This reading's unit or limits changed just now. Take the reading again" } as never)).toBe("maint.errors.kindChanged");
  });
});

describe("dueLines", () => {
  test("days first for a days plan, then hours", () => {
    expect(dueLines({ state: "soon", basis: "days", daysLeft: 4, hoursLeft: 30, hoursRun: 70 })).toEqual([
      { key: "maint.due.inDays", vars: { n: 4 } },
      { key: "maint.due.inHours", vars: { n: 30 } },
    ]);
  });
  test("hours first for an hours plan, overdue words", () => {
    expect(dueLines({ state: "overdue", basis: "hours", daysLeft: null, hoursLeft: -12, hoursRun: 512 })).toEqual([{ key: "maint.due.overHours", vars: { n: 12 } }]);
    expect(dueLines({ state: "overdue", basis: "days", daysLeft: -3, hoursLeft: null, hoursRun: null })).toEqual([{ key: "maint.due.overdueDays", vars: { n: 3 } }]);
    expect(dueLines({ state: "soon", basis: "days", daysLeft: 0, hoursLeft: null, hoursRun: null })).toEqual([{ key: "maint.due.today", vars: undefined }]);
  });
  test("never 'Over by 0 run hours': 1 left while time is left, 'reached' at exactly zero", () => {
    expect(dueLines({ state: "soon", basis: "hours", daysLeft: null, hoursLeft: 1, hoursRun: 9 })).toEqual([{ key: "maint.due.inHours", vars: { n: 1 } }]);
    expect(dueLines({ state: "overdue", basis: "hours", daysLeft: null, hoursLeft: 0, hoursRun: 10 })).toEqual([{ key: "maint.due.hoursNow" }]);
    expect(dueLines({ state: "soon", basis: "days", daysLeft: 2, hoursLeft: 0, hoursRun: 10 })[1]).toEqual({ key: "maint.due.hoursNow" });
  });
});

describe("numbers", () => {
  test("milli text round-trips", () => {
    for (const [text, milli] of [
      ["72", 72000],
      ["2.5", 2500],
      ["-1.25", -1250],
      ["0.001", 1],
    ] as const) {
      expect(parseMilli(text)).toBe(milli);
      expect(milliText(milli)).toBe(text);
    }
    expect(parseMilli("1.2345")).toBeNull();
    expect(parseMilli("abc")).toBeNull();
    expect(milliText(null)).toBe("");
  });
  test("hours and minutes", () => {
    expect(hoursMinutes(90)).toBe("1:30");
    expect(hoursMinutes(5)).toBe("0:05");
    expect(hoursMinutes(null)).toBe("");
  });
});

describe("refusal words", () => {
  test("server sentences map to dictionary keys, never raw text", () => {
    expect(maintErrorKey(new Error("Not found"))).toBe("maint.errors.notFound");
    expect(maintErrorKey(new Error("This work order changed since you opened it. Open it again."))).toBe("maint.errors.changed");
    expect(maintErrorKey(new Error("No asset points at this press yet. Add it to the asset register first"))).toBe("maint.errors.noAsset");
    expect(maintErrorKey(new Error("That store issue is already on a work order"))).toBe("maint.errors.spareTaken");
    expect(maintErrorKey({ message: "x", data: { code: "FORBIDDEN" } })).toBe("maint.errors.forbidden");
    expect(maintErrorKey(new Error("boom"))).toBe("maint.errors.unknown");
    expect(maintErrorKey(new Error("A start or finish time cannot be in the future"))).toBe("maint.errors.timeFuture");
    expect(maintErrorKey(new Error("A done work order keeps its start and finish times"))).toBe("maint.errors.doneKeepsTimes");
    expect(maintErrorKey(new Error("A press asset points at a press, a furnace asset at a furnace and an oven asset at an oven"))).toBe("maint.errors.linkKindMismatch");
    expect(maintErrorKey(new Error("This reading already has readings in its unit. Add a new reading kind for another unit"))).toBe("maint.errors.unitLocked");
    expect(maintErrorKey(new Error("This plan changed since you opened it. Open it again."))).toBe("maint.errors.changed");
  });
});

describe("work order list search", () => {
  test("keeps known filters and a sane asset id", () => {
    expect(parseWoSearch({ status: "done", asset: "a1" })).toEqual({ status: "done", asset: "a1" });
    expect(parseWoSearch({ status: "live" })).toEqual({});
    expect(parseWoSearch({ status: "nope", asset: "" })).toEqual({});
    expect(parseWoSearch({ asset: "x".repeat(65) })).toEqual({});
    expect(woFilterOf({})).toBe("live");
    expect(woFilterOf({ status: "all" })).toBe("all");
  });
});
