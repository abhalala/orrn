/**
 * W4-FIXES-B BACKLOG 51 (explorer M1): the plan form's default window is the CURRENT production day
 * in the company's time zone (`productionDayWindow`, specs §E2 window ≤ 24 h, §E7 production day),
 * read from the server's clock: never the browser's clock or zone.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const ist = (iso: string) => new Date(`${iso}+05:30`).getTime();
const DAY = { name: "Day", seq: 1, startMin: 8 * 60, endMin: 20 * 60 };
const NIGHT = { name: "Night", seq: 2, startMin: 20 * 60, endMin: 8 * 60 };

describe("plans.defaultWindow (BACKLOG 51)", () => {
  test("shifts from 08:00: the window is today 08:00 to tomorrow 08:00, plant time; before 08:00 it is the day before", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ shifts: [DAY, NIGHT] });
    const office = env.caller({ role: "office", companyId });

    setClock(new Date(ist("2026-10-25T12:40:00")));
    expect(await office.plans.defaultWindow()).toEqual({
      productionDay: "2026-10-25",
      startMs: ist("2026-10-25T08:00:00"),
      endMs: ist("2026-10-26T08:00:00"),
      timezone: "Asia/Kolkata",
    });

    // 02:00 on the 26th is still the 25th's production day (the night shift).
    setClock(new Date(ist("2026-10-26T02:00:00")));
    expect(await office.plans.defaultWindow()).toMatchObject({
      productionDay: "2026-10-25",
      startMs: ist("2026-10-25T08:00:00"),
      endMs: ist("2026-10-26T08:00:00"),
    });
  });

  test("no shifts: the calendar day from midnight in the company's zone; the window is 24 h", async () => {
    const { companyId } = await env.seedCompany();
    setClock(new Date(ist("2026-10-25T23:30:00")));
    const w = await env.caller({ role: "office", companyId }).plans.defaultWindow();
    expect(w).toMatchObject({ productionDay: "2026-10-25", startMs: ist("2026-10-25T00:00:00"), endMs: ist("2026-10-26T00:00:00") });
    expect(w.endMs - w.startMs).toBe(24 * 3_600_000);
  });

  test("reading it needs a plant member", async () => {
    await expect(env.caller(null).plans.defaultWindow()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
