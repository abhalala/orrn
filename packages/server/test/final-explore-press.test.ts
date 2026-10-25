/**
 * FINAL-EXPLORE-FIXES (explore/final.md): H1, the late-entry approval carries what the approver
 * needs (run, press line, copy, the entered start and stop); L2, `press.runs.start {}` is a 400.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { pressHelpers } from "./press-w2-fixture";

setDefaultTimeout(30_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);

describe("H1: a late entry request says what is being approved", () => {
  test("fresh run: meta names the run, press line, copy and the entered times; the approver reads them in approval.list", async () => {
    const p = await pressPlant();
    const sectionId = await p.section();
    const copyId = await p.copy(sectionId, { milli: 12_000 });
    const startedAt = Date.now() - 5 * 3_600_000;
    const stoppedAt = Date.now() - 3 * 3_600_000;
    const late = await p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: copyId, startedAt, stoppedAt, reason: "Tablet was down on the night shift" });
    const got = await p.as("manager").approval.list({ status: "pending", kind: "press_late_entry" });
    const req = got.items.find((i) => i.subjectId === late.id)!;
    const run = await p.as("manager").press.runs.get({ id: late.id });
    expect(req.meta).toMatchObject({
      runNumber: late.number,
      pressLineCode: run.line!.code,
      copyCode: run.copy!.code,
      startedAt,
      stoppedAt,
      reason: "Tablet was down on the night shift",
    });
    // A viewer reads the same request (approval.list is readable by every role): no money, no weights in it.
    const asViewer = await p.as("viewer").approval.list({ status: "pending", kind: "press_late_entry" });
    expect(asViewer.items.find((i) => i.subjectId === late.id)!.meta).toMatchObject({ runNumber: late.number, pressLineCode: run.line!.code });
  });

  test("queued run entered late: meta has the plan run's number, its line and the copy used", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    const startedAt = Date.now() - 6 * 3_600_000;
    const stoppedAt = Date.now() - 4 * 3_600_000;
    const late = await p.as("supervisor").press.runs.open({ runId: r.runId, dieInstanceId: r.copyId, startedAt, stoppedAt, reason: "Paper sheet only" });
    const run = await p.as("manager").press.runs.get({ id: r.runId });
    const got = await p.as("manager").approval.list({ status: "pending", kind: "press_late_entry" });
    expect(got.items.find((i) => i.subjectId === r.runId)!.meta).toMatchObject({
      runNumber: late.number,
      pressLineCode: run.line!.code,
      copyCode: run.copy!.code,
      startedAt,
      stoppedAt,
    });
  });
});

describe("L2: press.runs.start without a run", () => {
  test("is refused as a bad request with words, not a 500", async () => {
    const p = await pressPlant();
    await expect(p.as("press").press.runs.start({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("final explore L13: approval.decide refuses a role that approves nothing before reading its input", () => {
  test("viewer, empty body: 403; owner, empty body: 400", async () => {
    const { companyId } = await env.seedCompany();
    const viewer = env.caller({ role: "viewer", companyId });
    const owner = env.caller({ role: "owner", companyId });
    await expect(viewer.approval.decide({} as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.approval.decide({} as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
