/**
 * W4-MASTERS review I-2: every read that shows a reason code to a person carries the wording the
 * plant typed (labelHi / labelGu) and the `standard` flag, so the station, the run sheet, the day
 * summary and the report show it in the reader's language (built-in translation for a standard
 * code on its standard wording, the typed Hindi / Gujarati when there is one).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { pressRun } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers } from "./press-w2-fixture";

setDefaultTimeout(30_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);

describe("reason wording on downtime and QC reads", () => {
  test("downtime.list, runs.get, summary and report carry labelHi, labelGu and standard", async () => {
    const p = await pressPlant();
    const manager = p.as("manager");
    // power keeps its standard English wording; billet_wait gets typed Gujarati; a plant code is added.
    const powerId = await p.code("downtime", "power");
    const waitId = await p.code("downtime", "billet_wait");
    await manager.reasonCodes.rename({ id: waitId, label: "Waiting for billets", labelGu: "બિલેટ રાહ" });
    const added = await manager.reasonCodes.create({ kind: "downtime", label: "Crane busy", labelHi: "क्रेन व्यस्त" });

    const c = await p.castWith(kg(2_000));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    const press = p.as("press");
    for (const reasonCodeId of [powerId, waitId, added.id]) {
      const d = await press.press.downtime.start({ pressLineId: p.pressLineId, pressRunId: r.runId, reasonCodeId });
      await press.press.downtime.stop({ id: d.id });
    }

    const list = await press.press.downtime.list({ pressLineId: p.pressLineId });
    const by = (code: string) => list.find((x) => x.reasonCode === code)!;
    expect(by("power")).toMatchObject({ reasonLabel: "Power cut", labelHi: null, labelGu: null, standard: true });
    expect(by("billet_wait")).toMatchObject({ labelGu: "બિલેટ રાહ", standard: true });
    expect(by("crane_busy")).toMatchObject({ labelHi: "क्रेन व्यस्त", standard: false });

    const run = await p.as("supervisor").press.runs.get({ id: r.runId });
    expect(run.downtime.find((x) => x.reasonCode === "billet_wait")).toMatchObject({ labelGu: "બિલેટ રાહ", standard: true });
    expect(run.downtime.find((x) => x.reasonCode === "crane_busy")).toMatchObject({ labelHi: "क्रेन व्यस्त", standard: false });
    expect(run.qc[0]).toMatchObject({ reasonCode: "bend", standard: true, labelHi: null });

    await p.as("supervisor").press.runs.close({ id: r.runId });
    const [row] = await env.db.select().from(pressRun).where(eq(pressRun.id, r.runId));
    const s = await p.as("supervisor").press.summary({ productionDay: row!.productionDay! });
    expect(s.downtimeByReason.find((x) => x.code === "crane_busy")).toMatchObject({ labelHi: "क्रेन व्यस्त", standard: false });
    expect(s.downtimeByReason.find((x) => x.code === "billet_wait")).toMatchObject({ labelGu: "બિલેટ રાહ", standard: true });

    const rep = await p.as("supervisor").press.report({ from: row!.productionDay!, to: row!.productionDay! });
    const repRow = rep.rows.find((x) => x.id === r.runId)!;
    expect(repRow.downtimeCodes.sort()).toEqual(["billet_wait", "crane_busy", "power"]);
    expect(repRow.downtimeReasons.find((x) => x.code === "crane_busy")).toMatchObject({ label: "Crane busy", labelHi: "क्रेन व्यस्त", standard: false });
    expect(repRow.downtimeReasons.find((x) => x.code === "power")).toMatchObject({ standard: true });
  });
});
