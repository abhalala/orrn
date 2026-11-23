/**
 * Shared fixture for the maintenance tests (XE parity lane MAINT): a plant with a caller per role, a
 * press line, and helpers that write press runs, downtime, melts and oven batches straight into the
 * tables (the maintenance code only reads them).
 */
import { ageingBatch, ageingOven, cast, furnace, melt, pressDowntime, pressLine, pressRun, reasonCode, trolley } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import type { CompanyRole, TestEnv } from "./harness";

export const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

export const H = 3_600_000;
export const DAY = 86_400_000;
/** 2 Nov 2026 12:00 IST. */
export const NOON = new Date(Date.UTC(2026, 10, 2, 6, 30));

export async function errOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
  return { code: "OK", message: "" };
}

export function maintPlant(getEnv: () => TestEnv) {
  return async function plant(opts: { modules?: string[] } = {}) {
    const env = getEnv();
    const { companyId, users } = await env.seedCompany({ modules: opts.modules });
    const callers = Object.fromEntries(ROLES.map((role) => [role, env.caller({ role, companyId })])) as Record<CompanyRole, ReturnType<typeof env.caller>>;
    const lineId = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: lineId, companyId, code: "P1", name: "Press 1" });
    const dieId = await env.seedDie(companyId);
    let runN = 0;

    const reason = async (code: string) => {
      await callers.owner.press.reasons({ kind: "downtime" });
      const [r] = await env.db.select({ id: reasonCode.id }).from(reasonCode).where(and(eq(reasonCode.companyId, companyId), eq(reasonCode.kind, "downtime"), eq(reasonCode.code, code))).limit(1);
      if (!r) throw new Error(`no reason ${code}`);
      return r.id;
    };

    return {
      env,
      companyId,
      users,
      lineId,
      ...callers,
      as: (role: CompanyRole) => callers[role],
      /** A press run on the line from `start` to `stop` (null = still running). */
      async run(start: Date, stop: Date | null, status: "logged" | "running" | "voided" = "logged", line = lineId) {
        const id = crypto.randomUUID();
        runN += 1;
        await env.db.insert(pressRun).values({ id, companyId, number: `PR-T${runN}`, period: "2026-27", status, pressLineId: line, sectionId: dieId, startedAt: start, stoppedAt: stop });
        return id;
      },
      async downtime(start: Date, stop: Date | null, code = "breakdown", runId: string | null = null, note: string | null = null, line = lineId) {
        const id = crypto.randomUUID();
        await env.db.insert(pressDowntime).values({ id, companyId, pressLineId: line, pressRunId: runId, reasonCodeId: await reason(code), startedAt: start, stoppedAt: stop, note });
        return id;
      },
      async furnace() {
        const id = crypto.randomUUID();
        await env.db.insert(furnace).values({ id, companyId, code: "F1", name: "Furnace 1", capacityG: 5_000_000 });
        return id;
      },
      async melt(furnaceId: string, start: Date, end: Date, status: "locked" | "cancelled" = "locked") {
        const castId = crypto.randomUUID();
        await env.db.insert(cast).values({ id: castId, companyId, number: `K${Math.floor(Math.random() * 1e6)}`, period: "2026-11", year: 2026, month: 11, seq: Math.floor(Math.random() * 1e6), alloy: "6063", openedAt: start } as never);
        await env.db.insert(melt).values({ id: crypto.randomUUID(), companyId, castId, seq: 1, alloy: "6063", status, furnaceId, chargingStartAt: start, castingEndAt: end } as never);
      },
      async oven() {
        const id = crypto.randomUUID();
        await env.db.insert(ageingOven).values({ id, companyId, code: "OV-1", status: "active" });
        return id;
      },
      async batch(ovenId: string, inAt: Date, outAt: Date | null, status: "out" | "void" | "in_oven" = "out") {
        const trolleyId = crypto.randomUUID();
        await env.db.insert(trolley).values({ id: trolleyId, companyId, code: `T${Math.floor(Math.random() * 1e6)}` } as never);
        await env.db.insert(ageingBatch).values({ id: crypto.randomUUID(), companyId, number: `AG-${Math.floor(Math.random() * 1e6)}`, status, trolleyId, ovenId, inAt, outAt } as never);
      },
    };
  };
}

export type MaintPlant = Awaited<ReturnType<ReturnType<typeof maintPlant>>>;
