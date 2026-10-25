import { describe, expect, test } from "bun:test";

import { capacityCheck, type PressRunStatus } from "@orrn/domain";

import { capacityView, completeExtras, overCapacityLine, overReasonError } from "../features/dispatch/capacity";
import { hasTransport, transportFacts } from "../features/dispatch/transport";
import { shipDateChoice, shipDateFromChoice } from "../features/dispatch/ship-date";
import { addOutcome, blockOf, resultOutcome, type AddBundlesReport, type CapacityReport, type ScanResultRow } from "../features/scan/outcome";
import { canHandover, downtimeNoteMissing, gateTexts, handoverChanges, handoverChoices, isOpenRun, lineState, minutesBetween, queuedRunFor, recoveryText, runBanner, splitCards } from "../features/press/press-model";
import { stockTotals, type SectionRow } from "../features/stock/sections";
import { dayKeyIn, formatDay, formatTime, hourIn, monthNames, wallClock, zoneOf } from "../lib/format";
import { isSpoken, speechLang, speechOn } from "../lib/speech";

const cap = (loadedG: number, capacityG: number | null): CapacityReport => {
  const c = capacityCheck({ loadedG, capacityG });
  return { loadedG, capacityG, ...c } as CapacityReport;
};

describe("capacity banner states (FP-PK-12; the server decides, the phone names)", () => {
  test("no capacity set, or none given, shows nothing", () => {
    expect(capacityView(null)).toBeNull();
    expect(capacityView(undefined)).toBeNull();
    expect(capacityView(cap(1_000_000, null))).toBeNull();
  });

  test("ok below 95 percent: a fill line, no reason needed", () => {
    const v = capacityView(cap(1_000_000, 2_000_000))!;
    expect(v.state).toBe("ok");
    expect(v.headline).toEqual({ key: "dispatch.capacity.fill", vars: { pct: 50 } });
    expect(v.loaded).toEqual({ loaded: "1,000.0", capacity: "2,000.0" });
    expect(v.needsReason).toBe(false);
  });

  test("near from 95 percent, still no reason", () => {
    const v = capacityView(cap(1_950_000, 2_000_000))!;
    expect(v.state).toBe("near");
    expect(v.headline.key).toBe("dispatch.capacity.near");
    expect(v.pct).toBe(98);
    expect(v.needsReason).toBe(false);
  });

  test("over: says how many kg over, and Dispatch must ask why", () => {
    const v = capacityView(cap(2_150_000, 2_000_000))!;
    expect(v.state).toBe("over");
    expect(v.headline).toEqual({ key: "dispatch.capacity.over", vars: { kg: "150.0" } });
    expect(v.pct).toBe(100);
    expect(v.needsReason).toBe(true);
  });

  test("the reason is required and trimmed only when over; under capacity nothing extra is sent", () => {
    const over = capacityView(cap(2_150_000, 2_000_000));
    const ok = capacityView(cap(1_000_000, 2_000_000));
    expect(overReasonError(over, "  ")).toBe("required");
    expect(overReasonError(over, "x".repeat(501))).toBe("tooLong");
    expect(overReasonError(over, " Customer waited ")).toBeNull();
    expect(overReasonError(ok, "")).toBeNull();
    expect(completeExtras(over, " Customer waited ")).toEqual({ capacityOverrideReason: "Customer waited" });
    expect(completeExtras(ok, "ignored")).toEqual({});
    expect(completeExtras(null, "ignored")).toEqual({});
  });

  test("a scan that tips the truck over says so (spoken as well)", () => {
    expect(overCapacityLine(cap(2_150_000, 2_000_000))).toEqual({ key: "scan.continuous.overCapacity", vars: { kg: "150.0" } });
    expect(overCapacityLine(cap(1_000_000, 2_000_000))).toBeNull();
    expect(overCapacityLine(undefined)).toBeNull();
  });
});

describe("transporter and vehicle on the dispatch header (FP-PK-11)", () => {
  test("the master's name snapshot wins over the old free text; driver reads name and phone", () => {
    expect(transportFacts({ transporterName: "Sai Roadlines", transporter: "old text", vehicleNo: "GJ05AB1234", driverName: "Ramesh", driverPhone: "98250", vehicleCapacityG: 9_000_000 })).toEqual({
      transporter: "Sai Roadlines",
      vehicleNo: "GJ05AB1234",
      driver: "Ramesh, 98250",
      capacityKg: "9,000.0",
    });
    expect(transportFacts({ transporter: "old text" }).transporter).toBe("old text");
    expect(hasTransport(transportFacts({}))).toBe(false);
    expect(hasTransport(transportFacts({ vehicleNo: " GJ05 " }))).toBe(true);
  });
});

describe("scan reports from dispatch.scan (results, capacity, replay)", () => {
  const report = (over: Partial<AddBundlesReport>): AddBundlesReport => ({ added: [], alreadyInDispatch: [], notFound: [], unavailable: [], ...over });
  const row = (outcome: ScanResultRow["outcome"], over: Partial<ScanResultRow> = {}): ScanResultRow => ({ code: "4086", outcome, message: "English", bundleId: "b", serial: "26J10", heldBy: null, customerName: null, candidates: [], note: null, ...over });

  test("a party number typed names the bundle by its own serial", () => {
    expect(addOutcome(report({ results: [row("added")] }), "4086")).toEqual({ kind: "added", serial: "26J10", noOrder: false });
  });

  test("an office add that let a bundle through with no order is flagged", () => {
    expect(resultOutcome(row("added", { note: "unassigned" }))).toMatchObject({ kind: "added", noOrder: true });
  });

  test("ambiguous carries its candidates so the person can pick", () => {
    const out = resultOutcome(row("ambiguous", { candidates: ["26J10", "27A4086"], serial: null }));
    expect(out).toMatchObject({ kind: "rejected", code: "ambiguous", candidates: ["26J10", "27A4086"] });
    expect(out.kind === "rejected" && out.message).toEqual({ key: "scan.continuous.ambiguous", vars: { numbers: "26J10, 27A4086" } });
  });

  test("the refused row of the report carries the names an unavailable row lacks", () => {
    const r = report({
      unavailable: [{ serial: "26J10", reason: "x", code: "wrong_customer" }],
      refused: [{ serial: "26J10", code: "wrong_customer", reason: "x", heldBy: null, customerName: "Shreeji", candidates: [] }],
    });
    expect(blockOf(r, "26J10")).toMatchObject({ customerName: "Shreeji" });
    expect(addOutcome(r, "26J10")).toMatchObject({ code: "wrong_customer", message: { key: "scan.continuous.wrongCustomer", vars: { name: "Shreeji" } } });
  });

  test("an outside-order refusal (Q37 one sales order per packing list) has its floor sentence, with the order when sent", () => {
    expect(addOutcome(report({ unavailable: [{ serial: "S9", reason: "x", code: "outside_order" }] }), "S9")).toMatchObject({ message: { key: "scan.continuous.outsideOrderPlain" } });
    expect(addOutcome(report({ unavailable: [{ serial: "S9", reason: "x", code: "outside_order", orderNumber: "SO-14" }] }), "S9")).toMatchObject({
      message: { key: "scan.continuous.outsideOrder", vars: { order: "SO-14" } },
    });
  });

  test("an older report without results still reads the same way", () => {
    expect(addOutcome(report({ added: ["S1"] }), "S1")).toEqual({ kind: "added", serial: "S1" });
    expect(addOutcome(report({ alreadyInDispatch: ["S1"] }), "S1")).toEqual({ kind: "already", serial: "S1" });
    expect(addOutcome(report({}), "S1")).toEqual({ kind: "notFound", serial: "S1" });
  });
});

describe("speaking refusals (FP-PK-15)", () => {
  test("the language tag follows the app language", () => {
    expect(speechLang("hi")).toBe("hi-IN");
    expect(speechLang("gu")).toBe("gu-IN");
    expect(speechLang("en")).toBe("en-IN");
    expect(speechLang("xx")).toBe("en-IN");
  });

  test("on by default, off only when the person said so", () => {
    expect(speechOn(null)).toBe(true);
    expect(speechOn(undefined)).toBe(true);
    expect(speechOn("on")).toBe(true);
    expect(speechOn("off")).toBe(false);
  });

  test("refusals, misses and failures are spoken; calm results are not", () => {
    for (const k of ["rejected", "notFound", "error"] as const) expect(isSpoken(k)).toBe(true);
    for (const k of ["added", "already", "opened"] as const) expect(isSpoken(k)).toBe(false);
  });
});

describe("the press on a phone (spec E3 Native)", () => {
  test("a line is stopped, running or idle; downtime outranks the run", () => {
    expect(lineState({ running: "PR-41", openDowntime: false })).toEqual({ kind: "running", tone: "green", number: "PR-41" });
    expect(lineState({ running: "PR-41", openDowntime: true }).kind).toBe("downtime");
    expect(lineState({ running: null, openDowntime: false }).kind).toBe("idle");
  });

  test("a queued run says the start is locked; no state offers Start, Stop or Count on the phone", () => {
    expect(runBanner("queued")).toMatchObject({ tone: "amber", headline: "press.console.status.queued", detail: "press.console.startLocked" });
    for (const s of ["die_issued", "running", "stopped", "counting"] as const) expect(runBanner(s).detail).toBe("native.press.atTablet");
    expect(runBanner("logged").detail).toBeNull();
    expect(runBanner("voided").tone).toBe("red");
    expect(isOpenRun("counting")).toBe(true);
    expect(isOpenRun("logged")).toBe(false);
  });

  test("handover is for open runs that have their die, as the server allows", () => {
    expect(["queued", "die_issued", "running", "stopped", "counting", "logged", "voided"].map((s) => canHandover(s as never))).toEqual([false, true, true, true, true, false, false]);
  });

  test("the gate list is in the person's words; a code this build does not know shows the generic line", () => {
    const t = (k: string) => `[${k}]`;
    expect(gateTexts(t as never, ["no_cast", "downtime_open"])).toEqual(["[press.console.gates.no_cast]", "[press.console.gates.downtime_open]"]);
    expect(gateTexts(t as never, ["from_the_future"])).toEqual(["[native.press.gateUnknown]"]);
  });

  test("cards: runs on the press come first, the rest wait in the server's order", () => {
    const cards: { id: string; status: PressRunStatus }[] = [{ id: "a", status: "queued" }, { id: "b", status: "running" }, { id: "c", status: "die_issued" }, { id: "d", status: "counting" }];
    const s = splitCards(cards);
    expect(s.onPress.map((c) => c.id)).toEqual(["b", "d"]);
    expect(s.waiting.map((c) => c.id)).toEqual(["a", "c"]);
  });

  test("scanning a die copy opens its queued run: the one with the die issued first, else the first waiting; none = null; never started", () => {
    expect(queuedRunFor([{ id: "r1", number: "PR-1", status: "logged" }])).toBeNull();
    expect(queuedRunFor([{ id: "r1", number: "PR-1", status: "queued" }, { id: "r2", number: "PR-2", status: "die_issued" }])?.id).toBe("r2");
    expect(queuedRunFor([{ id: "r1", number: "PR-1", status: "queued" }, { id: "r3", number: "PR-3", status: "queued" }])?.id).toBe("r1");
    expect(queuedRunFor([{ id: "r9", number: "PR-9", status: "running" }])).toBeNull();
  });

  test("handover sends only what changed; a blank clears; people are chosen by role", () => {
    const before = { operatorId: "u1", reliefOperatorId: null, supervisorId: "u9" };
    expect(handoverChanges(before, before)).toEqual({});
    expect(handoverChanges(before, { ...before, reliefOperatorId: "u2" })).toEqual({ reliefOperatorId: "u2" });
    expect(handoverChanges(before, { ...before, operatorId: null })).toEqual({ operatorId: null });
    const members = [
      { role: "press", user: { id: "u1", name: "Vimal" } },
      { role: "supervisor", user: { id: "u9", name: "Anil" } },
      { role: "packer", user: { id: "u3", name: "Raju" } },
      { role: "operator", user: { id: "u4", name: "Chetan" } },
    ];
    const choices = handoverChoices(members, (r) => r === "press" || r === "supervisor", (r) => r === "supervisor");
    expect(choices.crew.map((p) => p.name)).toEqual(["Anil", "Chetan", "Vimal"]);
    expect(choices.bosses.map((p) => p.name)).toEqual(["Anil"]);
  });

  test("downtime: Other (or a reason the plant marked) needs a note; minutes never go below 0", () => {
    expect(downtimeNoteMissing({ code: "other", requiresNote: false }, " ")).toBe(true);
    expect(downtimeNoteMissing({ code: "power", requiresNote: true }, "")).toBe(true);
    expect(downtimeNoteMissing({ code: "power", requiresNote: false }, "")).toBe(false);
    expect(downtimeNoteMissing(undefined, "")).toBe(false);
    expect(minutesBetween("2026-10-24T08:00:00Z", "2026-10-24T08:42:20Z")).toBe(42);
    expect(minutesBetween("2026-10-24T09:00:00Z", "2026-10-24T08:00:00Z")).toBe(0);
  });

  test("recovery shows one decimal, half away from zero (7835 bp is 78.4)", () => {
    expect(recoveryText(7835)).toBe("78.4");
    expect(recoveryText(7545)).toBe("75.5");
    expect(recoveryText(null)).toBeNull();
  });
});

describe("stock totals are the server's (one in-stock figure)", () => {
  const row = (bundles: number, weightG: number, held: number, heldWeightG: number): SectionRow =>
    ({ dieId: "d", code: "1", series: "S", name: null, label: "S 1", bundles, weightG, held, heldWeightG, bandMinG: 0, bandMaxG: 0, state: "inStock", tone: "green" }) as SectionRow;

  test("the server's position wins over the sum of the rows on screen; held stays apart", () => {
    const rows = [row(2, 100_000, 1, 40_000)];
    expect(stockTotals({ inStock: { bundles: 9, pcs: 0, weightG: 900_000 }, held: { bundles: 3, pcs: 0, weightG: 120_000 } }, rows)).toEqual({ bundles: 9, weightG: 900_000, held: 3, heldWeightG: 120_000 });
  });

  test("an older server without the position falls back to the rows", () => {
    expect(stockTotals(undefined, [row(2, 100_000, 1, 40_000), row(1, 50_000, 0, 0)])).toEqual({ bundles: 3, weightG: 150_000, held: 1, heldWeightG: 40_000 });
  });
});

describe("dates are the company's, not the phone's (BACKLOG 29, T29 m-5)", () => {
  const months = monthNames("Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec");
  // 24 Oct 2026 22:30 UTC is 25 Oct 04:00 in Kolkata and 24 Oct 18:30 in New York.
  const instant = new Date("2026-10-24T22:30:00Z");
  const now = new Date("2026-10-25T06:00:00Z");

  test("the same instant reads as the plant's day and time whatever the phone's zone", () => {
    expect(formatDay(instant, months, now, "Asia/Kolkata")).toBe("25 Oct");
    expect(formatTime(instant, "Asia/Kolkata")).toBe("04:00");
    expect(formatDay(instant, months, now, "America/New_York")).toBe("24 Oct");
    expect(formatTime(instant, "America/New_York")).toBe("18:30");
  });

  test("the year is shown when it is not the plant's current year", () => {
    expect(formatDay(new Date("2025-12-30T10:00:00Z"), months, now, "Asia/Kolkata")).toBe("30 Dec 2025");
  });

  test("the company zone comes from settings.timezone, IST when it is missing", () => {
    expect(zoneOf({ timezone: "Asia/Dubai" })).toBe("Asia/Dubai");
    expect(zoneOf({})).toBe("Asia/Kolkata");
    expect(zoneOf(null)).toBe("Asia/Kolkata");
    expect(zoneOf({ timezone: "" })).toBe("Asia/Kolkata");
  });

  test("a zone this runtime does not know reads as IST like the server, not as the phone's clock", () => {
    expect(zoneOf({ timezone: "Mars/Olympus" })).toBe("Asia/Kolkata");
    expect(zoneOf({ timezone: 5 })).toBe("Asia/Kolkata");
    expect(dayKeyIn(zoneOf({ timezone: "Mars/Olympus" }), new Date("2026-10-23T20:00:00Z"))).toBe("2026-10-24");
  });

  test("a date-only text names a day: it prints that day in every zone and never shifts", () => {
    for (const zone of ["Asia/Kolkata", "America/Los_Angeles", "Pacific/Auckland", undefined]) {
      expect(formatDay("2026-10-24", months, now, zone)).toBe("24 Oct");
    }
    expect(formatTime("2026-10-24", "Asia/Kolkata")).toBeNull();
  });

  test("a ship date is read in UTC: the server keeps it as UTC midnight of the day", () => {
    const shipDate = Date.UTC(2026, 9, 24);
    expect(formatDay(shipDate, months, now, "UTC")).toBe("24 Oct");
    // In a zone west of UTC the same instant would have read the day before.
    expect(formatDay(shipDate, months, now, "America/Los_Angeles")).toBe("23 Oct");
  });

  test("an unknown zone falls back to the phone's clock instead of throwing", () => {
    expect(() => formatTime(instant, "Not/AZone")).not.toThrow();
    expect(wallClock(instant, "Not/AZone").year).toBe(instant.getFullYear());
  });

  test("empty and invalid dates are null", () => {
    expect(formatDay(null, months, now, "Asia/Kolkata")).toBeNull();
    expect(formatDay("not a date", months, now, "Asia/Kolkata")).toBeNull();
    expect(formatTime(undefined, "Asia/Kolkata")).toBeNull();
  });

  test("the greeting and today's day follow the plant's clock", () => {
    expect(hourIn("Asia/Kolkata", instant)).toBe(4);
    expect(hourIn("America/New_York", instant)).toBe(18);
    expect(dayKeyIn("Asia/Kolkata", instant)).toBe("2026-10-25");
    expect(dayKeyIn("America/New_York", instant)).toBe("2026-10-24");
  });

  test("the Today and Tomorrow ship-date chips are the plant's today, not the phone's", () => {
    expect(shipDateFromChoice({ kind: "today" }, instant, "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 25));
    expect(shipDateFromChoice({ kind: "today" }, instant, "America/New_York")).toBe(Date.UTC(2026, 9, 24));
    expect(shipDateFromChoice({ kind: "tomorrow" }, instant, "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 26));
    expect(shipDateChoice(Date.UTC(2026, 9, 25), instant, "Asia/Kolkata")).toEqual({ kind: "today" });
    expect(shipDateChoice(Date.UTC(2026, 9, 26), instant, "Asia/Kolkata")).toEqual({ kind: "tomorrow" });
  });

  test("no screen reads the phone's clock for a date a person sees", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dir, "..");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? walk(join(dir, e)) : /\.tsx$/.test(e) ? [join(dir, e)] : []));
    const bad = ["app", "features", "components"]
      .flatMap((d) => walk(join(root, d)))
      .filter((f) => /\.getHours\(\)|\.toLocale(Date|Time)String\(/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});

describe("reprint a label (E6 Native: reprint via the print service)", () => {
  test("a failed print is said in plain words; no answer at all is the connection", async () => {
    const { printErrorKey, canReprint, REPRINT_KEYS } = await import("../features/bundle/reprint");
    const { en } = await import("@orrn/i18n/en");
    const trpc = (code: string, message: string) => ({ data: { code }, message });
    expect(printErrorKey(new TypeError("Network request failed"))).toBe("pack.print.errors.network");
    expect(printErrorKey(trpc("FORBIDDEN", "x"))).toBe("pack.print.errors.forbidden");
    expect(printErrorKey(trpc("NOT_FOUND", "No active spool deployment"))).toBe("pack.print.errors.notSetUp");
    expect(printErrorKey(trpc("NOT_FOUND", "No label printer"))).toBe("pack.print.errors.noPrinter");
    expect(printErrorKey(trpc("BAD_REQUEST", "No template"))).toBe("pack.print.errors.noTemplate");
    expect(printErrorKey(trpc("BAD_GATEWAY", "x"))).toBe("pack.print.errors.offline");
    expect(printErrorKey(trpc("BAD_REQUEST", "Something else"))).toBe("pack.print.errors.generic");
    expect(canReprint("available")).toBe(true);
    expect(canReprint("void")).toBe(false);
    for (const k of REPRINT_KEYS) {
      const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], en);
      expect({ k, v: typeof v }).toEqual({ k, v: "string" });
    }
  });
});

describe("the phone only reads press runs, and writes downtime and handover (spec E3 Native)", () => {
  const sourceFiles = async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dir, "..");
    const skip = new Set(["node_modules", "__tests__", ".expo", "dist"]);
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => (skip.has(e) ? [] : statSync(join(dir, e)).isDirectory() ? walk(join(dir, e)) : /\.tsx?$/.test(e) ? [join(dir, e)] : []));
    return ["features", "app", "components", "lib", "utils"].flatMap((d) => walk(join(root, d)));
  };

  test("across the whole native app, press writes are downtime.start, downtime.stop and runs.handover and nothing else", async () => {
    const { readFileSync } = await import("node:fs");
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    const writes = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bpress\.([a-zA-Z.]+?)\.(?:mutationOptions|mutationKey|mutate|mutateAsync)\b/g)) writes.add(m[1]!);
    }
    expect([...writes].sort()).toEqual(["downtime.start", "downtime.stop", "runs.handover"]);
  });

  test("no phone file even names a run start, stop, count, close, reopen, void, resume or queue procedure", async () => {
    const { readFileSync } = await import("node:fs");
    const bad: string[] = [];
    for (const f of await sourceFiles()) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bpress\.(?:runs|queue|plan|lines)\.(start|stop|count|close|reopen|void|resume|undoStart|move|urgent|pullBack)\b/g)) bad.push(`${f}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  test("the scan tab never starts a run: it only lists the copy's runs", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dir, "..", "features/scan/scan-view.tsx"), "utf8");
    expect(src).toMatch(/trpc\.press\.runs\.list\.queryOptions/);
    expect(src).not.toMatch(/trpc\.press\.runs\.(?!list\b|get\b)/);
  });
});

describe("controls tell a screen reader their state (m-5)", () => {
  const src = async (rel: string) => (await import("node:fs")).readFileSync((await import("node:path")).join(import.meta.dir, "..", rel), "utf8");

  test("the radio rows of a radiogroup carry the radio role and the checked state", async () => {
    const row = await src("components/ui/list-row.tsx");
    expect(row).toMatch(/radioChecked === undefined \? "button" : "radio"/);
    expect(row).toMatch(/accessibilityState=\{radioChecked === undefined \? undefined : \{ checked: radioChecked \}\}/);
    for (const f of ["features/press/downtime-panel.tsx", "features/press/handover-sheet.tsx"]) {
      expect(await src(f)).toMatch(/radioChecked=\{selected\}/);
    }
  });

  test("the speech toggle is a switch with an on/off state", async () => {
    const view = await src("features/scan/scan-view.tsx");
    expect(view).toMatch(/accessibilityRole="switch"/);
    expect(view).toMatch(/accessibilityState=\{\{ checked: speaking \}\}/);
  });

  test("the band's joining word is translated in all three languages", async () => {
    const { en } = await import("@orrn/i18n/en");
    const { hi } = await import("@orrn/i18n/hi");
    const { gu } = await import("@orrn/i18n/gu");
    for (const dict of [en, hi, gu]) {
      const text = (dict as unknown as { units: { rangeTo: string } }).units.rangeTo;
      expect(text).toContain("{min}");
      expect(text).toContain("{max}");
    }
    expect((hi as unknown as { units: { rangeTo: string } }).units.rangeTo).not.toContain(" to ");
  });
});
