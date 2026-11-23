import { describe, expect, test } from "bun:test";

import { en, type MessageKey } from "@orrn/i18n/en";

import { downtimeLine, failedCastLine, ownerTiles, shiftDay, type OwnerFigures } from "./model";

function t(key: MessageKey, vars: Record<string, unknown> = {}): string {
  const raw = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
  if (typeof raw !== "string") throw new Error(`missing ${key}`);
  return raw.replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? `{${v}}`));
}
const fmt = { kg: (g: number) => `${g / 1000} kg`, pct: (bp: number) => `${bp / 100} %` };

const figures: OwnerFigures = {
  day: "2026-11-21",
  pressedG: 12_500,
  recoveryBp: 8_240,
  runs: 3,
  trialG: 400,
  downtime: [{ reason: "Die change", minutes: 35 }],
  downtimeMinutes: 35,
  dispatches: 2,
  dispatchedG: 9_000,
  openLines: 4,
  bakiG: 51_000,
  failedCasts: [{ number: "B12", alloy: "6063" }, { number: "B13", alloy: null }],
};

describe("ownerTiles", () => {
  const tiles = ownerTiles(figures, fmt, t);
  const by = (id: string) => tiles.find((x) => x.id === id)!;
  test("six tiles in page order", () => expect(tiles.map((x) => x.id)).toEqual(["pressed", "recovery", "downtime", "dispatched", "baki", "failed"]));
  test("pressed shows kg, runs and trials", () => {
    expect(by("pressed").value).toBe("12.5 kg");
    expect(by("pressed").notes.join(" | ")).toContain("3");
    expect(by("pressed").notes.join(" | ")).toContain("Trials 0.4 kg");
  });
  test("no trial note when no trial kg", () => expect(ownerTiles({ ...figures, trialG: 0 }, fmt, t).find((x) => x.id === "pressed")!.notes).toHaveLength(1));
  test("recovery is a percent, or the no-runs word", () => {
    expect(by("recovery").value).toBe("82.4 %");
    expect(ownerTiles({ ...figures, recoveryBp: null, runs: 0 }, fmt, t).find((x) => x.id === "recovery")!.value).toBe("No runs");
  });
  test("downtime lists reasons; empty says so", () => {
    expect(by("downtime").value).toBe("35 min");
    expect(by("downtime").lines).toEqual(["Die change 35 min"]);
    const none = ownerTiles({ ...figures, downtime: [], downtimeMinutes: 0 }, fmt, t).find((x) => x.id === "downtime")!;
    expect(none.empty).toBe("No downtime");
  });
  test("failed casts list number and alloy", () => {
    expect(by("failed").lines).toEqual(["B12 (6063)", "B13"]);
    expect(ownerTiles({ ...figures, failedCasts: [] }, fmt, t).find((x) => x.id === "failed")!.empty).toBe("None");
  });
});

test("line helpers", () => {
  expect(downtimeLine({ reason: "Power", minutes: 5 }, t)).toBe("Power 5 min");
  expect(failedCastLine({ number: "A1", alloy: null })).toBe("A1");
});

test("shiftDay crosses month and year ends", () => {
  expect(shiftDay("2026-12-01", -1)).toBe("2026-11-30");
  expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
});
