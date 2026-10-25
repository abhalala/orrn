import { describe, expect, test } from "bun:test";

import {
  MAX_BILLET_ROWS,
  PRESS_SKEW_MAX_MS,
  balanceG,
  bpPercent1,
  closeFigures,
  closeGates,
  moveInQueue,
  recoveryBp,
  skewUnconfirmed,
  sortPressQueue,
  theoreticalHintG,
  type CloseBilletRow,
  type CloseQcRow,
  type CloseRunInput,
  type CloseRunLine,
} from "./pressRun";

const KG = 1000;

describe("recovery and balance (spec E3 arithmetic)", () => {
  test("demo: 234.2 good of 310.4 billet kg = 7545 bp, shown 75.5 %", () => {
    const bp = recoveryBp(234_200, 310_400);
    expect(bp).toBe(7545);
    expect(bpPercent1(bp!)).toBe("75.5");
  });

  test("display rounds half away from zero to one decimal: 7835 -> 78.4, 286 -> 2.9, 9530 -> 95.3, -286 -> -2.9", () => {
    expect(bpPercent1(7835)).toBe("78.4");
    expect(bpPercent1(286)).toBe("2.9");
    expect(bpPercent1(9530)).toBe("95.3");
    expect(bpPercent1(-286)).toBe("-2.9");
    expect(bpPercent1(5)).toBe("0.1");
    expect(bpPercent1(4)).toBe("0.0");
    expect(bpPercent1(10_000)).toBe("100.0");
  });

  test("no input: no recovery", () => {
    expect(recoveryBp(1, 0)).toBeNull();
  });

  test("demo balance: 310.4 in, 234.2 good, 30 butt, 10 ends, 4.8 rejects = 31.4 kg, warns above 2 %", () => {
    const b = balanceG({ inputG: 310_400, goodG: 234_200, discardG: 30 * KG, endsG: 10 * KG, rejectG: 4_800 });
    expect(b).toEqual({ balanceG: 31_400, warn: true });
  });

  test("balance inside 2 % does not warn; exactly 2 % does not warn; the band is a setting", () => {
    expect(balanceG({ inputG: 100 * KG, goodG: 80 * KG, discardG: 18 * KG }).warn).toBe(false); // 2 kg = 2 %
    expect(balanceG({ inputG: 100 * KG, goodG: 80 * KG, discardG: 17_900 }).warn).toBe(true); // 2.1 kg
    expect(balanceG({ inputG: 100 * KG, goodG: 80 * KG, discardG: 17_900, warnBp: 300 }).warn).toBe(false);
    // Over-explained (negative balance) warns by size too.
    expect(balanceG({ inputG: 100 * KG, goodG: 99 * KG, discardG: 5 * KG })).toEqual({ balanceG: -4 * KG, warn: true });
  });
});

describe("theoretical hint and time skew", () => {
  test("pcs x cut / 12 ft x kg per 12 ft (never stored)", () => {
    // 10 pieces of exactly 12 ft at 5.967 kg / 12 ft = 59.67 kg; the integer mm cut rounds once.
    expect(theoreticalHintG({ pcs: 10, cutLengthMm: 3658, kgPer12ftMilli: 5_967 })).toBe(59_677);
    expect(theoreticalHintG({ pcs: 20, cutLengthMm: 1829, kgPer12ftMilli: 6_000 })).toBe(60_007);
    expect(theoreticalHintG({ pcs: 10, cutLengthMm: 3658, kgPer12ftMilli: null })).toBeNull();
    expect(theoreticalHintG({ pcs: 0, cutLengthMm: 3658, kgPer12ftMilli: 6_000 })).toBeNull();
  });

  test("skew above 2 min marks the time unconfirmed; no tap = server time, confirmed", () => {
    const server = 1_800_000_000_000;
    expect(skewUnconfirmed(server, server - PRESS_SKEW_MAX_MS)).toBe(false);
    expect(skewUnconfirmed(server, server - PRESS_SKEW_MAX_MS - 1)).toBe(true);
    expect(skewUnconfirmed(server, server + 3 * 60_000)).toBe(true);
    expect(skewUnconfirmed(server, null)).toBe(false);
  });
});

describe("closeGates (spec E3 close gates)", () => {
  const run = (over: Partial<CloseRunInput> = {}): CloseRunInput => ({
    status: "counting",
    supervisorId: "sup",
    castId: "cast-k31",
    timeUnconfirmed: false,
    ...over,
  });
  const lines: CloseRunLine[] = [{ cutLengthMm: 3658, pcs: 40, goodG: 234_200 }];
  const billets: CloseBilletRow[] = [{ castId: "cast-k31", count: 8, kgG: 310_400 }];
  const zeroQc: CloseQcRow[] = [{ pcs: 0, kgG: 0, reasonCode: null }];
  const ctx = { callerId: "sup", callerCanClose: true, billetOnHandG: 5_000 * KG };

  test("a complete run passes every gate", () => {
    expect(closeGates(run(), lines, billets, zeroQc, [{ stoppedAt: 1 }], {}, ctx)).toEqual([]);
  });

  test("status, caller and supervisor", () => {
    expect(closeGates(run({ status: "stopped" }), lines, billets, zeroQc, [], {}, ctx)).toEqual(["not_counting"]);
    expect(closeGates(run(), lines, billets, zeroQc, [], {}, { ...ctx, callerId: "other" })).toEqual(["not_supervisor"]);
    expect(closeGates(run(), lines, billets, zeroQc, [], {}, { ...ctx, callerCanClose: false })).toEqual(["no_close_permission"]);
    expect(closeGates(run({ supervisorId: null }), lines, billets, zeroQc, [], {}, ctx)).toEqual(["not_supervisor"]);
  });

  test("cast and billets: set, matching, 1..10 rows, counted and weighed", () => {
    expect(closeGates(run({ castId: null }), lines, billets, zeroQc, [], {}, ctx)).toEqual(["no_cast"]);
    expect(closeGates(run(), lines, [], zeroQc, [], {}, ctx)).toEqual(["no_billets", "no_input"]);
    expect(closeGates(run(), lines, [{ castId: "cast-j4", count: 8, kgG: 310_400 }], zeroQc, [], {}, ctx)).toEqual(["billet_cast_mismatch"]);
    expect(closeGates(run(), lines, [{ castId: "cast-k31", count: 8, kgG: 0 }], zeroQc, [], {}, ctx)).toEqual(["billet_row_invalid", "no_input"]);
    const eleven = Array.from({ length: MAX_BILLET_ROWS + 1 }, () => ({ castId: "cast-k31", count: 1, kgG: 30 * KG }));
    expect(closeGates(run(), lines, eleven, zeroQc, [], {}, ctx)).toEqual(["too_many_billets"]);
  });

  test("pieces: at least one row, pieces need kg, good within input, within pressed length", () => {
    expect(closeGates(run(), [], billets, zeroQc, [], {}, ctx)).toEqual(["no_lines"]);
    expect(closeGates(run(), [{ cutLengthMm: 3658, pcs: 5, goodG: 0 }], billets, zeroQc, [], {}, ctx)).toEqual(["line_without_kg", "no_good"]);
    expect(closeGates(run(), [{ cutLengthMm: 3658, pcs: 40, goodG: 320 * KG }], billets, zeroQc, [], {}, ctx)).toEqual(["good_over_input"]);
    expect(closeGates(run({ pressedLengthMm: 100_000 }), lines, billets, zeroQc, [], {}, ctx)).toEqual(["pieces_over_pressed_length"]);
    expect(closeGates(run({ pressedLengthMm: 40 * 3658 }), lines, billets, zeroQc, [], {}, ctx)).toEqual([]);
  });

  test("QC: a row is required; a zero row is fine; a reject needs a reason; other needs a note", () => {
    expect(closeGates(run(), lines, billets, [], [], {}, ctx)).toEqual(["no_qc"]);
    expect(closeGates(run(), lines, billets, [{ pcs: 2, kgG: 4_800, reasonCode: null }], [], {}, ctx)).toEqual(["qc_reason_missing"]);
    expect(closeGates(run(), lines, billets, [{ pcs: 2, kgG: 4_800, reasonCode: "bend" }], [], {}, ctx)).toEqual([]);
    expect(closeGates(run(), lines, billets, [{ pcs: 2, kgG: 4_800, reasonCode: "other" }], [], {}, ctx)).toEqual(["qc_note_missing"]);
    expect(closeGates(run(), lines, billets, [{ pcs: 2, kgG: 4_800, reasonCode: "other", note: "twisted" }], [], {}, ctx)).toEqual([]);
    expect(closeGates(run(), lines, billets, [{ pcs: 1, kgG: 1, reasonCode: "custom", reasonRequiresNote: true, note: " " }], [], {}, ctx)).toEqual(["qc_note_missing"]);
  });

  test("billets short of the cast's BILLET on hand need a reason (1-500)", () => {
    const short = { ...ctx, billetOnHandG: 300 * KG };
    expect(closeGates(run(), lines, billets, zeroQc, [], {}, short)).toEqual(["billet_short_reason_missing"]);
    expect(closeGates(run({ billetShortReason: "weighed twice" }), lines, billets, zeroQc, [], {}, short)).toEqual([]);
    expect(closeGates(run({ billetShortReason: "x".repeat(501) }), lines, billets, zeroQc, [], {}, short)).toEqual(["billet_short_reason_missing"]);
  });

  test("times, late entry, downtime and trial result", () => {
    expect(closeGates(run({ timeUnconfirmed: true }), lines, billets, zeroQc, [], {}, ctx)).toEqual(["time_unconfirmed"]);
    expect(closeGates(run({ timeUnconfirmed: true, pressTimeApproved: true }), lines, billets, zeroQc, [], {}, ctx)).toEqual([]);
    expect(closeGates(run({ lateEntry: true }), lines, billets, zeroQc, [], {}, ctx)).toEqual(["late_entry_unapproved"]);
    expect(closeGates(run({ lateEntry: true, lateEntryApproved: true }), lines, billets, zeroQc, [], {}, ctx)).toEqual([]);
    expect(closeGates(run(), lines, billets, zeroQc, [{ stoppedAt: 1 }, { stoppedAt: null }], {}, ctx)).toEqual(["downtime_open"]);
    expect(closeGates(run({ purpose: "die_trial" }), lines, billets, zeroQc, [], {}, ctx)).toEqual(["trial_result_missing"]);
    expect(closeGates(run({ purpose: "die_trial", trialResult: "fail" }), lines, billets, zeroQc, [], {}, ctx)).toEqual([]);
  });
});

describe("closeFigures (server-computed; client values ignored)", () => {
  test("demo run", () => {
    const f = closeFigures({
      billets: [{ kgG: 200_000 }, { kgG: 110_400 }],
      lines: [{ goodG: 134_200 }, { goodG: 100_000 }],
      qc: [{ kgG: 4_800 }, { kgG: 0 }],
      discardG: 30 * KG,
      endsG: 10 * KG,
      billetOnHandG: 1_000 * KG,
    });
    expect(f).toEqual({ inputG: 310_400, inputWeighedG: 310_400, goodG: 234_200, rejectG: 4_800, recoveryBp: 7545, balanceG: 31_400, balanceWarn: true, short: false, billetShortG: 0 });
  });

  test("D22 short billets: input and recovery stay on the weighed kg; the shortfall is recorded", () => {
    const f = closeFigures({ billets: [{ kgG: 310_400 }], lines: [{ goodG: 234_200 }], qc: [], billetOnHandG: 300 * KG });
    expect([f.inputG, f.inputWeighedG, f.short, f.recoveryBp, f.billetShortG]).toEqual([310_400, 310_400, true, 7545, 10_400]);
  });

  test("D22 nothing or less than nothing on hand: the whole weighed kg is short, recovery unchanged", () => {
    const none = closeFigures({ billets: [{ kgG: 310_400 }], lines: [{ goodG: 234_200 }], qc: [], billetOnHandG: 0 });
    expect([none.inputG, none.recoveryBp, none.billetShortG]).toEqual([310_400, 7545, 310_400]);
    const negative = closeFigures({ billets: [{ kgG: 310_400 }], lines: [{ goodG: 234_200 }], qc: [], billetOnHandG: -5 * KG });
    expect([negative.inputG, negative.recoveryBp, negative.billetShortG, negative.short]).toEqual([310_400, 7545, 310_400, true]);
    const unknown = closeFigures({ billets: [{ kgG: 310_400 }], lines: [{ goodG: 234_200 }], qc: [] });
    expect([unknown.short, unknown.billetShortG]).toEqual([false, 0]);
  });
});

describe("press queue (FP-PR-25)", () => {
  test("urgent first, then queue position, then run number", () => {
    const runs = [
      { id: "a", queuePos: null, seq: 1 },
      { id: "b", queuePos: 2, seq: 2 },
      { id: "c", queuePos: 1, seq: 3 },
      { id: "d", queuePos: 5, seq: 4, urgent: true },
    ];
    expect(sortPressQueue(runs).map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
  });

  test("moving one run renumbers the queue 1..n", () => {
    expect(moveInQueue(["a", "b", "c"], "c", 0)).toEqual([
      { id: "c", queuePos: 1 },
      { id: "a", queuePos: 2 },
      { id: "b", queuePos: 3 },
    ]);
    expect(moveInQueue(["a", "b", "c"], "a", 99).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(() => moveInQueue(["a"], "z", 0)).toThrow();
  });
});
