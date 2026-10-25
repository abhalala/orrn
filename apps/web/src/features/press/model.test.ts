import { describe, expect, test } from "bun:test";

import { can, type CompanyRole } from "@orrn/server/lib/permissions";
import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import { gu } from "@orrn/i18n/gu";

import {
  bannerOf,
  billetRows,
  CLOSE_GATE_CODES,
  clockOf,
  COUNT_STEPS,
  elapsedText,
  gateKey,
  gateSentences,
  isLastStep,
  kgTextToG,
  LATE_ENTRY_DAYS,
  lateEntryIssue,
  lineRows,
  movedOrder,
  notesToSend,
  percentOfBp,
  pollIntervalFor,
  qcRows,
  leadOnLine,
  reorderTarget,
  splitQueue,
  STATION_ACTION,
  stationActions,
  stepOfGate,
  stepStates,
  wholeText,
} from "./model";

const t = (key: string) => key;
const mm = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : null);
const dig = (tree: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], tree);

describe("gate text mapping", () => {
  test("every close gate code has a sentence in en, hi and gu (the station speaks the floor's language)", () => {
    for (const code of CLOSE_GATE_CODES) {
      const key = gateKey(code)!;
      expect({ code, en: typeof dig(en, key) }).toEqual({ code, en: "string" });
      expect({ code, hi: typeof dig(hi, key) }).toEqual({ code, hi: "string" });
      expect({ code, gu: typeof dig(gu, key) }).toEqual({ code, gu: "string" });
    }
  });

  test("an unknown code falls back to the server's sentence, then to the code", () => {
    expect(gateKey("brand_new_gate")).toBeNull();
    expect(gateSentences(["no_cast", "brand_new_gate", "other"], t, ["x", "Server says so"])).toEqual(["press.console.gates.no_cast", "Server says so", "other"]);
  });

  test("the refused-close sentences keep the server's order", () => {
    expect(gateSentences(["no_qc", "no_cast"], t)).toEqual(["press.console.gates.no_qc", "press.console.gates.no_cast"]);
  });
});

describe("station banner and actions", () => {
  test("queued is locked and has no Start; die_issued has Start; running has Stop", () => {
    expect(bannerOf("queued")).toBe("locked");
    expect(bannerOf("die_issued")).toBe("ready");
    expect(bannerOf("running")).toBe("running");
    expect(bannerOf("stopped")).toBe("stopped");
    expect(bannerOf("counting")).toBe("counting");
    expect(bannerOf("logged")).toBe("logged");
    expect(bannerOf("voided")).toBe("voided");
    expect(stationActions("queued").start).toBe(false);
    expect(stationActions("die_issued").start).toBe(true);
    expect(stationActions("running").stop).toBe(true);
    expect(stationActions("running").start).toBe(false);
    expect(stationActions("stopped").count).toBe(true);
  });

  test("what each state offers does not depend on who looks: the button's <Can> decides the rest", () => {
    expect(stationActions("counting").logRun).toBe(true);
    expect(stationActions("logged").requestReopen).toBe(true);
    expect(stationActions("logged").logRun).toBe(false);
    expect(stationActions("queued").void).toBe(true);
    expect(stationActions("die_issued").void).toBe(true);
    expect(stationActions("running").void).toBe(false);
    expect(Object.values(stationActions("voided")).every((v) => v === false)).toBe(true);
  });

  test("every station button names the action it needs; the matrix is the server's (review r1 I-1, m-1, m-2)", () => {
    const holds = (role: CompanyRole, button: keyof typeof STATION_ACTION) => {
      const need = STATION_ACTION[button];
      const me = { company: { role }, isPlatformAdmin: false, platformRole: null };
      return (Array.isArray(need) ? need : [need]).some((a) => can(me as never, a));
    };
    // Manager and admin hold press.close but not press.run: they see the counting panel and Log run.
    for (const role of ["manager", "admin"] as const) {
      expect(holds(role, "countingPanel")).toBe(true);
      expect(holds(role, "logRun")).toBe(true);
      expect(holds(role, "requestReopen")).toBe(true);
      expect(holds(role, "start")).toBe(false);
      expect(holds(role, "saveCount")).toBe(false);
    }
    expect(holds("owner", "logRun")).toBe(true);
    // The supervisor does both; the press man runs but never logs or reopens.
    expect(holds("supervisor", "logRun")).toBe(true);
    expect(holds("supervisor", "saveCount")).toBe(true);
    expect(holds("press", "start")).toBe(true);
    expect(holds("press", "countingPanel")).toBe(true);
    expect(holds("press", "logRun")).toBe(false);
    expect(holds("press", "requestReopen")).toBe(false);
    expect(holds("press", "void")).toBe(false);
    // Void: press.close holders and the planner (order.plan: office), as the server allows.
    expect(holds("office", "void")).toBe(true);
    expect(holds("manager", "void")).toBe(true);
    expect(holds("supervisor", "void")).toBe(true);
    // A viewer gets nothing.
    for (const button of Object.keys(STATION_ACTION) as (keyof typeof STATION_ACTION)[]) expect({ button, viewer: holds("viewer", button) }).toEqual({ button, viewer: false });
  });

  test("downtime only while running or stopped; handover on an open run", () => {
    expect(stationActions("running").downtime).toBe(true);
    expect(stationActions("counting").downtime).toBe(false);
    expect(stationActions("counting").handover).toBe(true);
    expect(stationActions("logged").handover).toBe(false);
  });

  test("a running run polls every 10 s, nothing else polls", () => {
    expect(pollIntervalFor("running")).toBe(10_000);
    expect(pollIntervalFor("counting")).toBe(false);
    expect(pollIntervalFor(undefined)).toBe(false);
  });
});

describe("counting stepper", () => {
  test("billets, pieces, butt and ends, rejects, remark and reading", () => {
    expect([...COUNT_STEPS]).toEqual(["billets", "pieces", "scrap", "rejects", "remark"]);
    expect(stepStates(2).map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(stepStates(-3)[0]!.state).toBe("current");
    expect(stepStates(99)[4]!.state).toBe("current");
    expect(isLastStep(4)).toBe(true);
    expect(isLastStep(3)).toBe(false);
  });

  test("a failing gate sends the person to the step that fixes it", () => {
    expect(stepOfGate("no_cast")).toBe(0);
    expect(stepOfGate("billet_short_reason_missing")).toBe(0);
    expect(stepOfGate("no_good")).toBe(1);
    expect(stepOfGate("good_over_input")).toBe(1);
    expect(stepOfGate("no_qc")).toBe(3);
    expect(stepOfGate("qc_note_missing")).toBe(3);
    expect(stepOfGate("downtime_open")).toBe(4);
    expect(stepOfGate("trial_result_missing")).toBe(4);
  });
});

describe("typed values", () => {
  test("kg text to grams and whole numbers", () => {
    expect(kgTextToG("155.2")).toBe(155_200);
    expect(kgTextToG("1,234.5")).toBe(1_234_500);
    expect(kgTextToG("")).toBeNull();
    expect(kgTextToG("abc")).toBeNull();
    expect(wholeText("80")).toBe(80);
    expect(wholeText("8.5")).toBeNull();
  });

  test("billet rows skip blank rows and refuse a half-typed one", () => {
    expect(billetRows([{ key: "a", lengthText: "600", countText: "4", kgText: "155.2" }, { key: "b", lengthText: "", countText: "", kgText: "" }], mm)).toEqual({
      rows: [{ lengthMm: 600, count: 4, kgG: 155_200 }],
    });
    expect(billetRows([{ key: "a", lengthText: "600", countText: "4", kgText: "" }], mm)).toEqual({ issue: "invalid" });
    expect(billetRows([{ key: "a", lengthText: "abc", countText: "4", kgText: "10" }], mm)).toEqual({ issue: "invalid" });
    expect(billetRows([{ key: "a", lengthText: "", countText: "4", kgText: "10" }], mm)).toEqual({ rows: [{ lengthMm: null, count: 4, kgG: 10_000 }] });
  });

  test("piece rows carry the plan line; kg may be blank only when pcs is blank too", () => {
    const ok = lineRows([{ key: "a", cutLengthMm: 3658, cutText: "", pcsText: "80", kgText: "234.2", pressPlanLineId: "pl1", orderNumber: "SO-1", releasedPcs: 100 }], mm);
    expect(ok).toEqual({ rows: [{ cutLengthMm: 3658, pcs: 80, goodG: 234_200, pressPlanLineId: "pl1" }] });
    expect(lineRows([{ key: "a", cutLengthMm: null, cutText: "", pcsText: "80", kgText: "1", pressPlanLineId: null, orderNumber: null, releasedPcs: null }], mm)).toEqual({ issue: "invalid" });
    expect(lineRows([{ key: "a", cutLengthMm: null, cutText: "3658", pcsText: "80", kgText: "1", pressPlanLineId: null, orderNumber: null, releasedPcs: null }], mm)).toEqual({
      rows: [{ cutLengthMm: 3658, pcs: 80, goodG: 1000, pressPlanLineId: null }],
    });
    expect(lineRows([{ key: "a", cutLengthMm: 3658, cutText: "", pcsText: "", kgText: "", pressPlanLineId: null, orderNumber: null, releasedPcs: null }], mm)).toEqual({ rows: [] });
  });

  test("a zero reject row is the 'none' check; a positive one carries reason and note", () => {
    expect(qcRows([{ key: "a", pcsText: "0", kgText: "0", reasonCodeId: "r", note: "x", runLine: 1 }])).toEqual({
      rows: [{ pcs: 0, kgG: 0, reasonCodeId: null, note: null, runLine: 1 }],
    });
    expect(qcRows([{ key: "a", pcsText: "3", kgText: "7", reasonCodeId: "bend", note: " ", runLine: null }])).toEqual({
      rows: [{ pcs: 3, kgG: 7000, reasonCodeId: "bend", note: null, runLine: null }],
    });
    expect(qcRows([{ key: "a", pcsText: "", kgText: "", reasonCodeId: "", note: "", runLine: null }])).toEqual({ rows: [] });
  });
});

describe("queue", () => {
  const cards = [
    { id: "r1", status: "running" },
    { id: "r2", status: "counting" },
    { id: "w1", status: "die_issued" },
    { id: "w2", status: "queued" },
    { id: "w3", status: "queued" },
  ];

  test("on the line and waiting never overlap (the QA 'queue 1, lists 2' contradiction)", () => {
    const { onLine, waiting } = splitQueue(cards);
    expect(onLine.map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(waiting.map((c) => c.id)).toEqual(["w1", "w2", "w3"]);
    expect(onLine.length + waiting.length).toBe(cards.length);
  });

  test("the line board leads with the running run, not the first card on the line", () => {
    expect(leadOnLine([{ status: "counting" }, { status: "running" }])?.status).toBe("running");
    expect(leadOnLine([{ status: "stopped" }, { status: "counting" }])).toEqual({ status: "stopped" });
    expect(leadOnLine([{ status: "counting" }, { status: "running" }, { status: "running" }])).toEqual({ status: "running" });
    expect(leadOnLine([])).toBeUndefined();
  });

  test("move up / down targets stop at the ends", () => {
    const { waiting } = splitQueue(cards);
    expect(reorderTarget(waiting, "w1", "up")).toBeNull();
    expect(reorderTarget(waiting, "w1", "down")).toBe(1);
    expect(reorderTarget(waiting, "w3", "down")).toBeNull();
    expect(reorderTarget(waiting, "w3", "up")).toBe(1);
    expect(reorderTarget(waiting, "nope", "up")).toBeNull();
  });

  test("the optimistic order after a move", () => {
    const { waiting } = splitQueue(cards);
    expect(movedOrder(waiting, "w3", 0).map((c) => c.id)).toEqual(["w3", "w1", "w2"]);
    expect(movedOrder(waiting, "w1", 2).map((c) => c.id)).toEqual(["w2", "w3", "w1"]);
    expect(movedOrder(waiting, "w1", 99).map((c) => c.id)).toEqual(["w2", "w3", "w1"]);
  });
});

describe("formatting", () => {
  test("clock in the plant zone, elapsed, percent", () => {
    expect(clockOf(Date.UTC(2026, 9, 24, 8, 30), "Asia/Kolkata")).toBe("14:00");
    expect(clockOf(null)).toBe("");
    expect(elapsedText(72 * 60 * 1000 + 5000)).toBe("1:12:05");
    expect(elapsedText(125_000)).toBe("02:05");
    expect(percentOfBp(7545)).toBe("75.5");
    expect(percentOfBp(null)).toBe("");
  });
});

describe("remark and die reading retries are idempotent (review r1 m-3)", () => {
  const server = { pressRemark: "Ram slow", dieRemark: null, lastReadingMilli: 2700 };
  const typed = { pressRemark: "Ram slow", dieRemark: "", readingMilli: null };

  test("a remark the server already holds is not sent again, a changed one is", () => {
    expect(notesToSend(typed, server, true, {})).toEqual({});
    expect(notesToSend({ ...typed, pressRemark: "  Ram slow  " }, server, true, {})).toEqual({});
    expect(notesToSend({ ...typed, pressRemark: "Ram slow again" }, server, true, {})).toEqual({ press: "Ram slow again" });
    expect(notesToSend({ ...typed, pressRemark: "" }, server, true, {})).toEqual({});
  });

  test("a die remark needs a die copy", () => {
    expect(notesToSend({ ...typed, dieRemark: "Bearing worn" }, server, true, {})).toEqual({ die: "Bearing worn" });
    expect(notesToSend({ ...typed, dieRemark: "Bearing worn" }, server, false, {})).toEqual({});
  });

  test("a reading whose first send may have landed (same value now the latest) is skipped; a new measurement is sent", () => {
    expect(notesToSend({ ...typed, readingMilli: 2700 }, server, true, {})).toEqual({ reading: 2700 });
    expect(notesToSend({ ...typed, readingMilli: 2700 }, server, true, { reading: 2700 })).toEqual({});
    expect(notesToSend({ ...typed, readingMilli: 2710 }, server, true, { reading: 2700 })).toEqual({ reading: 2710 });
    expect(notesToSend({ ...typed, readingMilli: 2700 }, server, false, {})).toEqual({});
  });
});

describe("late entry window (review r1 I-3)", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0);
  const day = 86_400_000;

  test("the rule is 7 days", () => {
    expect(LATE_ENTRY_DAYS).toBe(7);
  });

  test("order, future stop and older than 7 days are each named; a good window passes", () => {
    expect(lateEntryIssue({ startMs: now - 3_600_000, stopMs: now - 7_200_000, nowMs: now })).toBe("order");
    expect(lateEntryIssue({ startMs: now - 7_200_000, stopMs: now + 60_000, nowMs: now })).toBe("future");
    expect(lateEntryIssue({ startMs: now - 7 * day - 1, stopMs: now - 7 * day + 3_600_000, nowMs: now })).toBe("tooOld");
    expect(lateEntryIssue({ startMs: now - 7 * day, stopMs: now - 7 * day + 3_600_000, nowMs: now })).toBeNull();
    expect(lateEntryIssue({ startMs: now - 3 * 3_600_000, stopMs: now - 2 * 3_600_000, nowMs: now })).toBeNull();
    expect(lateEntryIssue({ startMs: null, stopMs: now, nowMs: now })).toBe("order");
  });
});
