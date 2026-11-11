/**
 * Fixture for the Infinity Portal merge tests (lane B). Seeds approved candidates with staged rows
 * straight into D1 (the dry run is lane A's and has its own tests), builds callers, and pumps a
 * merge run through the real `ingest.merge.*` procedures.
 *
 * Until the lead swaps lane A's stub in `lib/ingest/engines.ts` for `lib/ingest/merge`, the fixture
 * points the stub's methods at the merge engine, so the procedures run exactly as they will.
 */
import type { CompanyRole } from "@orrn/db/schema/tenant";
import type { IngestTarget, RowState } from "@orrn/db/schema/ingest";

import type { Context } from "../src/context";
import type { appRouter } from "../src/routers/index";
import type { TestEnv } from "./harness";

export type SeedRow = {
  state?: RowState;
  values: Record<string, unknown>;
  matchId?: string | null;
  diff?: Record<string, { live: unknown; file: unknown }> | null;
  rowKey?: string;
};

let n = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${(n += 1).toString(36)}`;

export async function wireMergeEngine(): Promise<void> {
  const engines = await import("../src/lib/ingest/engines");
  const merge = await import("../src/lib/ingest/merge");
  Object.assign(engines.mergeEngine, merge.mergeEngine);
}

/** One approved candidate with its artifact, block and staged rows. Returns ids and row keys. */
export async function seedCandidate(
  env: TestEnv,
  companyId: string,
  target: IngestTarget,
  rows: readonly SeedRow[],
  opts: { sheet?: string; state?: "approved" | "ready" } = {},
): Promise<{ candidateId: string; artifactId: string; blockId: string; rowIds: string[]; rowKeys: string[] }> {
  const { ingestArtifact, ingestBlock, ingestCandidate, ingestStagedRow } = await import("@orrn/db/schema/ingest");
  const artifactId = uniq("art");
  const blockId = uniq("blk");
  const candidateId = uniq("cand");
  await env.db.insert(ingestArtifact).values({
    id: artifactId,
    companyId,
    sha256: uniq("sha").padEnd(64, "0"),
    fileName: `${target}.csv`,
    kind: "csv",
    sizeBytes: 100,
    vaultState: "not_stored",
    readState: "read",
  });
  await env.db.insert(ingestBlock).values({
    id: blockId,
    companyId,
    artifactId,
    ordinal: 0,
    sheetName: opts.sheet ?? `${target} sheet`,
    headerRow: 0,
    headers: ["a"],
    kinds: ["text"],
    headerKey: "k",
    columnCount: 1,
    rowCount: rows.length,
    rowsPut: rows.length,
    sample: [],
  });
  await env.db.insert(ingestCandidate).values({
    id: candidateId,
    companyId,
    artifactId,
    blockId,
    target,
    holeRef: `builtin:${target}@1`,
    fit: "exact",
    state: opts.state ?? "approved",
    rowsTotal: rows.length,
  });
  const rowIds: string[] = [];
  const rowKeys: string[] = [];
  for (const [i, r] of rows.entries()) {
    const id = uniq("row");
    const rowKey = r.rowKey ?? uniq("key");
    rowIds.push(id);
    rowKeys.push(rowKey);
    await env.db.insert(ingestStagedRow).values({
      id,
      companyId,
      rowKey,
      candidateId,
      rowIndex: i,
      raw: [],
      values: { _ids: {}, ...r.values },
      state: r.state ?? "ready_create",
      matchId: r.matchId ?? null,
      diff: r.diff ?? null,
    });
  }
  return { candidateId, artifactId, blockId, rowIds, rowKeys };
}

/** The person's context exactly as the harness builds it for `caller()` (no Better Auth). */
export async function contextFor(env: TestEnv, companyId: string, role: CompanyRole): Promise<Context> {
  const { membership, user } = await import("@orrn/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const [row] = await env.db
    .select({ userId: user.id, name: user.name, email: user.email, membershipId: membership.id })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.companyId, companyId), eq(membership.role, role)))
    .limit(1);
  if (!row) throw new Error(`No ${role} in ${companyId}`);
  return {
    auth: null,
    db: env.db,
    request: new Request("https://api.test"),
    impersonation: null,
    impersonationHeaderRejected: false,
    companyHeaderRejected: false,
    session: { user: { id: row.userId, name: row.name, email: row.email }, session: { id: "test-session" } } as unknown as Context["session"],
    membership: { id: row.membershipId, companyId, role, companyStatus: "active" as const },
    companyId,
    role,
    isPlatformAdmin: false,
    platformRole: null,
  } as Context;
}

export type Api = ReturnType<typeof appRouter.createCaller>;

export async function apiFor(ctx: Context): Promise<Api> {
  const routers = await import("../src/routers/index");
  return routers.appRouter.createCaller(ctx);
}

/** Start a merge and pump it to the end; returns the run id and its last step. */
export async function mergeAll(api: Api, maxSteps = 200) {
  const { runId } = await api.ingest.merge.start();
  return { runId, ...(await pump(api, runId, 0, maxSteps)) };
}

export async function pump(api: Api, runId: string, cursor: number, maxSteps = 200) {
  let last = { state: "planning" as string, cursor, chunksTotal: 0, chunksWritten: 0, chunksFailed: 0 };
  for (let i = 0; i < maxSteps; i += 1) {
    last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
    if (last.state !== "planning" && last.state !== "running") return last;
  }
  throw new Error("The merge did not finish");
}

export async function stagedRows(env: TestEnv, candidateId: string) {
  const { ingestStagedRow } = await import("@orrn/db/schema/ingest");
  const { asc, eq } = await import("drizzle-orm");
  return env.db.select().from(ingestStagedRow).where(eq(ingestStagedRow.candidateId, candidateId)).orderBy(asc(ingestStagedRow.rowIndex));
}

export async function candidateRow(env: TestEnv, candidateId: string) {
  const { ingestCandidate } = await import("@orrn/db/schema/ingest");
  const { eq } = await import("drizzle-orm");
  const [c] = await env.db.select().from(ingestCandidate).where(eq(ingestCandidate.id, candidateId));
  return c!;
}

export async function auditRows(env: TestEnv, companyId: string, action: string) {
  const { auditLog } = await import("@orrn/db/schema/audit");
  const { and, eq } = await import("drizzle-orm");
  return env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)));
}

/**
 * Put a finished run back where a crash between the procedure call and the state write leaves it:
 * the chunk `sent`, its rows `queued` with no committed id, the candidate `merging`, the run
 * `running` with the cursor of that step.
 */
export async function rewindToCrash(env: TestEnv, runId: string, candidateId: string): Promise<number> {
  const { ingestCandidate, ingestMergeChunk, ingestMergeRun, ingestStagedRow } = await import("@orrn/db/schema/ingest");
  const { and, eq } = await import("drizzle-orm");
  const [run] = await env.db.select().from(ingestMergeRun).where(eq(ingestMergeRun.id, runId));
  const cursor = run!.cursor - 2;
  await env.db
    .update(ingestMergeRun)
    .set({ state: "running", cursor, finishedAt: null, chunksWritten: run!.chunksWritten - 1 })
    .where(eq(ingestMergeRun.id, runId));
  await env.db
    .update(ingestMergeChunk)
    .set({ state: "sent", writtenAt: null })
    .where(and(eq(ingestMergeChunk.runId, runId), eq(ingestMergeChunk.candidateId, candidateId)));
  await env.db
    .update(ingestStagedRow)
    .set({ mergeState: "queued", committedType: null, committedId: null })
    .where(eq(ingestStagedRow.candidateId, candidateId));
  await env.db.update(ingestCandidate).set({ state: "merging" }).where(eq(ingestCandidate.id, candidateId));
  return cursor;
}
