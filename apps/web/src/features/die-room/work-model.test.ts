import { describe, expect, test } from "bun:test";

import { canLogWork, todayYmd, workInput, workKindLabel, ymdToWorkedAt, type WorkDraft } from "./work-model";

const t = ((key: string) => (key === "reasons.die_work.polish" ? "Polish" : key)) as never;
const base: WorkDraft = { kindId: "k1", code: "polish", requiresNote: false, day: "2026-10-20", hv: "", note: "", backOnTrial: false };

describe("FP-DR-18 work form", () => {
  test("kind label: seeded code translated, plant code keeps its label", () => {
    expect(workKindLabel(t, "polish", "Polish")).toBe("Polish");
    expect(workKindLabel(t, "porthole", "Porthole repair")).toBe("Porthole repair");
  });
  test("day: noon IST, invalid dates refused", () => {
    expect(ymdToWorkedAt("2026-10-20")).toBe(Date.UTC(2026, 9, 20, 6, 30));
    expect(ymdToWorkedAt("2026-02-30")).toBeNull();
    expect(ymdToWorkedAt("")).toBeNull();
    expect(todayYmd(new Date(Date.UTC(2026, 9, 20, 20, 0)))).toBe("2026-10-21"); // 01:30 IST next day
  });
  test("input: optional HV and note; trial only with a correction", () => {
    expect(workInput(base, "c1", "2026-10-25")).toEqual({ ok: true, input: { dieInstanceId: "c1", reasonCodeId: "k1", workedAt: Date.UTC(2026, 9, 20, 6, 30) } });
    expect(workInput({ ...base, hv: "980", note: " Bearing " }, "c1", "2026-10-25")).toMatchObject({ ok: true, input: { hardness: 980, note: "Bearing" } });
    expect(workInput({ ...base, backOnTrial: true }, "c1", "2026-10-25")).toMatchObject({ ok: true, input: expect.not.objectContaining({ setOnTrial: true }) });
    expect(workInput({ ...base, code: "correct", backOnTrial: true }, "c1", "2026-10-25")).toMatchObject({ ok: true, input: { setOnTrial: true } });
  });
  test("errors: kind, note for other, future day, bad HV", () => {
    expect(workInput({ ...base, kindId: "" }, "c1", "2026-10-25")).toEqual({ ok: false, error: "kind" });
    expect(workInput({ ...base, code: "other" }, "c1", "2026-10-25")).toEqual({ ok: false, error: "note" });
    expect(workInput({ ...base, day: "2026-10-26" }, "c1", "2026-10-25")).toEqual({ ok: false, error: "day" });
    expect(workInput({ ...base, hv: "9.5" }, "c1", "2026-10-25")).toEqual({ ok: false, error: "hv" });
  });
  test("rack only", () => {
    expect(canLogWork("available")).toBe(true);
    expect(canLogWork("on_trial")).toBe(true);
    expect(canLogWork("in_use")).toBe(false);
    expect(canLogWork("retired")).toBe(false);
  });
});
