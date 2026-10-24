import { and, desc, eq } from "drizzle-orm";

import { backupRun } from "@orrn/db/schema/platform";

import { actionProcedure, router } from "../index";

/**
 * The plant's backup card (FP-PF-12; `settings.update`): the last export and the last drill. No
 * R2 key and no download: the plant cannot fetch or restore its own backup.
 */
export const backupRouter = router({
  status: actionProcedure("settings.update").query(async ({ ctx }) => {
    const latest = async (purpose: "export" | "drill", status?: "succeeded") =>
      (await ctx.db
        .select({
          id: backupRun.id,
          status: backupRun.status,
          bytes: backupRun.bytes,
          startedAt: backupRun.startedAt,
          finishedAt: backupRun.finishedAt,
        })
        .from(backupRun)
        .where(
          and(
            eq(backupRun.companyId, ctx.companyId),
            eq(backupRun.purpose, purpose),
            ...(status ? [eq(backupRun.status, status)] : []),
          ),
        )
        .orderBy(desc(backupRun.startedAt), desc(backupRun.id))
        .limit(1)
        .get()) ?? null;
    const view = (r: Awaited<ReturnType<typeof latest>>) =>
      r
        ? {
            id: r.id,
            status: r.status === "succeeded" ? ("ok" as const) : r.status,
            bytes: r.bytes,
            startedAt: r.startedAt.toISOString(),
            finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
          }
        : null;
    const [lastOk, lastAttempt, drill] = await Promise.all([
      latest("export", "succeeded"),
      latest("export"),
      latest("drill"),
    ]);
    return {
      lastOk: view(lastOk),
      /** Shown when newer than the last Ok (a failed or running attempt). */
      lastAttempt: lastAttempt && lastAttempt.id !== lastOk?.id ? view(lastAttempt) : null,
      lastDrill: view(drill),
    };
  }),
});
