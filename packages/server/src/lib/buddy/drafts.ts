/**
 * Confirm-first writes, browser side (design 2026-11-18, §4.4, §7, §10, §12; fix round decisions 6, 8, 9).
 *
 * `confirmDraft` runs only from `buddy.drafts.confirm`, under the browser request's own context:
 * - it re-reads the draft (this company, this person, pending, unexpired, its grant not revoked) and re-decides
 *   the path it runs, so a draft row that names a denied path can never run;
 * - Confirm and Reject are one atomic claim: Confirm sets `claimed_at` only while the draft is pending and
 *   unclaimed, and Reject settles only a pending, unclaimed draft. So Reject cannot win while Confirm runs;
 * - a draft runs at most once. A claim that never settled (the Worker died after the write, or the settle failed)
 *   is never run again: the next Confirm or Reject settles it `failed` with words that ask the person to check;
 * - it runs the procedure through `appRouter.createCaller({ ...ctx, buddyDraftId })`, so every rule of the real
 *   procedure applies as that person, and the procedure's own audit row carries `meta.buddyDraftId`;
 * - the draft id is always the `clientRequestId` (or `clientMutationId`) where the target takes one, and an
 *   ingest draft on a candidate runs with the candidate's current `expectSeq`;
 * - an audit row is written only when the settling UPDATE matched (same batch, guarded INSERT … SELECT);
 * - a decided draft's stored outcome is the answer to every later confirm (replay).
 */
import { auditLog, buddyDraft, buddyGrant, type BuddyDraftDecidedVia } from "@orrn/db/schema";
import { ingestArtifact, ingestBlock, ingestCandidate } from "@orrn/db/schema/ingest";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { ZodError } from "zod";

import type { Context } from "../../context";
import { atomicBatch, mapInChunks } from "../atomic";
import { auditInsertGuarded } from "../audit";
import { now } from "../clock";
import { refusedInput } from "./decisions";
import { draftView, fillsExpectSeq, KIND_TARGET, REQUEST_KEYS, type DraftNames, type DraftRow } from "./draftView";
import { capResult } from "./envelope";
import { allowedProcedure, roleHoldsGuard, validateInput, type BuddyProcedure } from "./registry";
import type { BuddyDraftView } from "./views";

type BrowserCtx = Context & { companyId: string; session: NonNullable<Context["session"]> };

/** A claim older than this is a confirm that died mid-run. It is never run again (decision 6). */
export const DRAFT_CLAIM_STALE_MS = 2 * 60 * 1000;
export const UNKNOWN_OUTCOME = "orrn could not tell if this went through. Check the screen before you try again.";
export const NOT_ALLOWED = "The buddy may not make this change.";
export const CHANGE_FAILED = "The change failed.";
const BEING_CONFIRMED = "This draft is being confirmed.";
const DECIDED_SHOWN = 20;

const draftColumns = {
  id: buddyDraft.id,
  path: buddyDraft.path,
  kind: buddyDraft.kind,
  inputJson: buddyDraft.inputJson,
  status: buddyDraft.status,
  createdAt: buddyDraft.createdAt,
  expiresAt: buddyDraft.expiresAt,
  resultJson: buddyDraft.resultJson,
  failure: buddyDraft.failure,
  originPlatform: buddyDraft.originPlatform,
  decidedVia: buddyDraft.decidedVia,
  claimedAt: buddyDraft.claimedAt,
  grantId: buddyDraft.grantId,
};
type Row = DraftRow & { claimedAt: Date | null; grantId: string | null };

function mine(ctx: BrowserCtx, draftId: string) {
  return and(
    eq(buddyDraft.companyId, ctx.companyId),
    eq(buddyDraft.requestedByUserId, ctx.session.user.id),
    eq(buddyDraft.id, draftId),
  );
}

async function readMine(ctx: BrowserCtx, draftId: string): Promise<Row> {
  const row = await ctx.db.select(draftColumns).from(buddyDraft).where(mine(ctx, draftId)).get();
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  return row;
}

/** Sheet and file names for the ids the cards show (decision 9). Only this plant's rows. */
async function namesFor(ctx: BrowserCtx, rows: Row[]): Promise<DraftNames> {
  const candidates = new Set<string>();
  const artifacts = new Set<string>();
  for (const r of rows) {
    const input = r.inputJson as { candidateId?: unknown; artifactId?: unknown } | null;
    if (!input || typeof input !== "object") continue;
    if (typeof input.candidateId === "string") candidates.add(input.candidateId);
    if (typeof input.artifactId === "string") artifacts.add(input.artifactId);
  }
  const names = new Map<string, string>();
  if (candidates.size > 0) {
    const found = await mapInChunks([...candidates], (ids) =>
      ctx.db
        .select({ id: ingestCandidate.id, fileName: ingestArtifact.fileName, sheetName: ingestBlock.sheetName, title: ingestBlock.title, ordinal: ingestBlock.ordinal })
        .from(ingestCandidate)
        .innerJoin(ingestBlock, eq(ingestBlock.id, ingestCandidate.blockId))
        .innerJoin(ingestArtifact, eq(ingestArtifact.id, ingestCandidate.artifactId))
        .where(and(eq(ingestCandidate.companyId, ctx.companyId), inArray(ingestCandidate.id, ids))),
    );
    for (const c of found) names.set(c.id, `${c.fileName} / ${c.sheetName ?? c.title ?? `Table ${c.ordinal + 1}`}`);
  }
  if (artifacts.size > 0) {
    const found = await mapInChunks([...artifacts], (ids) =>
      ctx.db
        .select({ id: ingestArtifact.id, fileName: ingestArtifact.fileName })
        .from(ingestArtifact)
        .where(and(eq(ingestArtifact.companyId, ctx.companyId), inArray(ingestArtifact.id, ids))),
    );
    for (const a of found) names.set(a.id, a.fileName);
  }
  return names;
}

async function viewOf(ctx: BrowserCtx, row: Row): Promise<BuddyDraftView> {
  return draftView(row, await namesFor(ctx, [row]));
}

export async function listMyDrafts(ctx: BrowserCtx): Promise<BuddyDraftView[]> {
  const base = and(eq(buddyDraft.companyId, ctx.companyId), eq(buddyDraft.requestedByUserId, ctx.session.user.id));
  const pending = await ctx.db
    .select(draftColumns)
    .from(buddyDraft)
    .where(and(base, eq(buddyDraft.status, "pending")))
    .orderBy(desc(buddyDraft.createdAt), desc(buddyDraft.id))
    .limit(100);
  const decided = await ctx.db
    .select(draftColumns)
    .from(buddyDraft)
    .where(and(base, ne(buddyDraft.status, "pending")))
    .orderBy(desc(buddyDraft.decidedAt), desc(buddyDraft.createdAt))
    .limit(DECIDED_SHOWN);
  const rows = [...pending, ...decided];
  const names = await namesFor(ctx, rows);
  const at = now();
  return rows.map((r) => draftView(r, names, at));
}

type Settle = {
  status: "confirmed" | "rejected" | "expired" | "failed";
  resultJson?: unknown;
  failure?: string | null;
};

/**
 * Mark a pending draft decided, conditional on it still being pending and on `claim` (null: unclaimed; a date: the
 * claim this caller holds or found stale). The audit row lands only when that UPDATE matched (review N1).
 */
async function settle(ctx: BrowserCtx, row: Row, set: Settle, action: string, via: BuddyDraftDecidedVia, claim: Date | null): Promise<void> {
  const at = now();
  const userId = ctx.session.user.id;
  const claimed = claim === null ? isNull(buddyDraft.claimedAt) : eq(buddyDraft.claimedAt, claim);
  await atomicBatch(ctx.db, [
    ctx.db
      .update(buddyDraft)
      .set({ ...set, decidedBy: userId, decidedAt: at, decidedVia: via })
      .where(and(mine(ctx, row.id), eq(buddyDraft.status, "pending"), claimed)),
    auditInsertGuarded(
      ctx,
      {
        action,
        subjectType: "buddy_draft",
        subjectId: row.id,
        meta: { path: row.path, kind: row.kind, via, ...(set.failure ? { failure: set.failure } : {}) },
      },
      {
        from: buddyDraft,
        where: and(mine(ctx, row.id), eq(buddyDraft.status, set.status), eq(buddyDraft.decidedAt, at), eq(buddyDraft.decidedBy, userId)),
      },
    ),
  ]);
}

const stale = (claimedAt: Date, at: Date) => claimedAt.getTime() < at.getTime() - DRAFT_CLAIM_STALE_MS;

/**
 * The common start of Confirm and Reject. Returns the view when the draft is already decided or was settled here
 * (stale claim, lapsed); throws CONFLICT while a confirm holds a fresh claim; else null (go on).
 */
async function settleIfDone(ctx: BrowserCtx, row: Row, via: BuddyDraftDecidedVia): Promise<BuddyDraftView | null> {
  if (row.status !== "pending") return viewOf(ctx, row);
  const at = now();
  if (row.claimedAt) {
    if (!stale(row.claimedAt, at)) throw new TRPCError({ code: "CONFLICT", message: BEING_CONFIRMED });
    // At most once: a confirm that never settled may have written. Never run it again.
    await settle(ctx, row, { status: "failed", failure: UNKNOWN_OUTCOME }, "buddy.draft.fail", via, row.claimedAt);
    return viewOf(ctx, await readMine(ctx, row.id));
  }
  if (row.expiresAt.getTime() <= at.getTime()) {
    await settle(ctx, row, { status: "expired" }, "buddy.draft.expire", via, null);
    return viewOf(ctx, await readMine(ctx, row.id));
  }
  return null;
}

/** Only server refusals are stored as they are; anything else (a raw database or runtime error) is plain words (review N3). */
const SHOWN_CODES = new Set(["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED", "TOO_MANY_REQUESTS", "UNAUTHORIZED", "PAYLOAD_TOO_LARGE", "UNPROCESSABLE_CONTENT"]);

export function failureText(error: unknown): string {
  if (error instanceof TRPCError && SHOWN_CODES.has(error.code)) {
    if (error.cause instanceof ZodError) return "The input does not fit.";
    return error.message.slice(0, 500);
  }
  return CHANGE_FAILED;
}

type Caller = Record<string, unknown>;

async function callerFor(ctx: BrowserCtx, draftId: string): Promise<Caller> {
  const { appRouter } = await import("../../routers/index");
  return appRouter.createCaller({ ...ctx, buddyDraftId: draftId }) as unknown as Caller;
}

/** Call an allowed procedure path (decided "allow" and present in the registry) on the caller. */
function callPath(caller: Caller, path: string, input: unknown): Promise<unknown> {
  let target: unknown = caller;
  for (const segment of path.split(".")) target = (target as Record<string, unknown>)[segment];
  if (typeof target !== "function") throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  return (target as (i: unknown) => Promise<unknown>)(input);
}

type CandidateNow = { serverSeq: number; state: string; dryCursor: number };
const candidateNow = (caller: Caller, candidateId: string) => callPath(caller, "ingest.candidate.get", { candidateId }) as Promise<CandidateNow>;

/** The input as Confirm runs it: the draft id as request key, the candidate's current expectSeq (decision 8, S3). */
async function runInput(caller: Caller, entry: BuddyProcedure, row: Row): Promise<unknown> {
  const input = row.inputJson;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const key of REQUEST_KEYS) if (entry.fields.includes(key)) out[key] = row.id;
  if (entry.fields.includes("expectSeq") && fillsExpectSeq(entry.path, input)) {
    out.expectSeq = (await candidateNow(caller, out.candidateId as string)).serverSeq;
  }
  const valid = validateInput(entry, out);
  if (!valid.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "The input does not fit." });
  return out;
}

class AnswersStopped extends Error {
  constructor(
    readonly applied: number,
    readonly total: number,
    readonly inner: unknown,
  ) {
    super("answers stopped");
  }
}

/** kind "answers": `ingest.answer.set` for each answer, in order, with the current expectSeq each time. */
async function runAnswers(caller: Caller, entry: BuddyProcedure, row: Row): Promise<unknown> {
  const { candidateId, answers } = row.inputJson as { candidateId: string; answers: { questionCode: string; subject: string; answer: unknown }[] };
  let applied = 0;
  let candidate: unknown = null;
  let seq: number | null = null;
  for (const a of answers) {
    try {
      // The current expectSeq: read once, then the one each answer.set hands back (the candidate after that write).
      const serverSeq = seq ?? (await candidateNow(caller, candidateId)).serverSeq;
      const one = { candidateId, questionCode: a.questionCode, subject: a.subject, answer: a.answer, expectSeq: serverSeq };
      if (refusedInput(entry.decision, one) || !validateInput(entry, one).ok) throw new TRPCError({ code: "BAD_REQUEST", message: "The input does not fit." });
      candidate = await callPath(caller, entry.path, one);
      seq = (candidate as { serverSeq?: unknown } | null)?.serverSeq as number;
      if (typeof seq !== "number") seq = null;
      applied += 1;
    } catch (error) {
      throw new AnswersStopped(applied, answers.length, error);
    }
  }
  return { applied, total: answers.length, candidate };
}

/** kind "dryRun": check the candidate can run now; the browser pumps `ingest.dryRun.step` after the confirm. */
async function startDryRun(caller: Caller, row: Row): Promise<unknown> {
  const { candidateId } = row.inputJson as { candidateId: string };
  const c = await candidateNow(caller, candidateId);
  if (c.state !== "processing") {
    throw new TRPCError({ code: "BAD_REQUEST", message: c.state === "ready" ? "This import is already checked" : "This import is not ready to check" });
  }
  return { candidateId, cursor: c.dryCursor, state: c.state };
}

/** The procedure the draft runs, when the buddy may still reach it with this input; else null. */
async function decided(ctx: BrowserCtx, row: Row): Promise<BuddyProcedure | null> {
  const path = row.kind === "procedure" ? row.path : KIND_TARGET[row.kind];
  const entry = await allowedProcedure(path);
  if (!entry) return null;
  if (row.kind === "procedure" && refusedInput(entry.decision, row.inputJson)) return null;
  if (row.kind !== "procedure" && roleHoldsGuard(entry.guard, ctx.role ?? null) === false) return null;
  return entry;
}

async function grantLive(ctx: BrowserCtx, grantId: string | null): Promise<boolean> {
  if (!grantId) return false;
  const g = await ctx.db
    .select({ revokedAt: buddyGrant.revokedAt })
    .from(buddyGrant)
    .where(and(eq(buddyGrant.id, grantId), eq(buddyGrant.companyId, ctx.companyId)))
    .get();
  return !!g && g.revokedAt === null;
}

export async function confirmDraft(ctx: BrowserCtx, draftId: string, via: BuddyDraftDecidedVia): Promise<BuddyDraftView> {
  const row = await readMine(ctx, draftId);
  const done = await settleIfDone(ctx, row, via);
  if (done) return done;

  // Security L1: a draft of a grant that was cut off never runs.
  if (!(await grantLive(ctx, row.grantId))) {
    await settle(ctx, row, { status: "expired" }, "buddy.draft.expire", via, null);
    return viewOf(ctx, await readMine(ctx, draftId));
  }
  const entry = await decided(ctx, row);
  if (!entry) {
    await settle(ctx, row, { status: "failed", failure: NOT_ALLOWED }, "buddy.draft.fail", via, null);
    return viewOf(ctx, await readMine(ctx, draftId));
  }

  // Claim: only one confirm runs the draft, and only while no reject or other confirm decided it.
  const claim = now();
  const claimed = await ctx.db
    .update(buddyDraft)
    .set({ claimedAt: claim })
    .where(and(mine(ctx, draftId), eq(buddyDraft.status, "pending"), isNull(buddyDraft.claimedAt)))
    .returning({ id: buddyDraft.id });
  if (claimed.length === 0) {
    const again = await readMine(ctx, draftId);
    if (again.status !== "pending") return viewOf(ctx, again);
    throw new TRPCError({ code: "CONFLICT", message: BEING_CONFIRMED });
  }

  // Everything after the claim runs inside the try, so a refusal settles the draft instead of leaving a claim.
  try {
    const caller = await callerFor(ctx, row.id);
    let result: unknown;
    if (row.kind === "answers") result = await runAnswers(caller, entry, row);
    else if (row.kind === "dryRun") result = await startDryRun(caller, row);
    else result = await callPath(caller, entry.path, await runInput(caller, entry, row));
    const capped = capResult(result);
    await settle(ctx, row, { status: "confirmed", resultJson: capped.data ?? null }, "buddy.draft.confirm", via, claim);
  } catch (error) {
    if (error instanceof AnswersStopped) {
      await settle(
        ctx,
        row,
        { status: "failed", failure: failureText(error.inner), resultJson: { applied: error.applied, total: error.total } },
        "buddy.draft.fail",
        via,
        claim,
      );
    } else {
      await settle(ctx, row, { status: "failed", failure: failureText(error) }, "buddy.draft.fail", via, claim);
    }
  }
  return viewOf(ctx, await readMine(ctx, draftId));
}

export async function rejectDraft(ctx: BrowserCtx, draftId: string, via: BuddyDraftDecidedVia): Promise<BuddyDraftView> {
  const row = await readMine(ctx, draftId);
  const done = await settleIfDone(ctx, row, via);
  if (done) return done;
  // Settles only a pending, unclaimed draft: a confirm that took the claim first wins.
  await settle(ctx, row, { status: "rejected" }, "buddy.draft.reject", via, null);
  const after = await readMine(ctx, draftId);
  if (after.status === "pending") throw new TRPCError({ code: "CONFLICT", message: BEING_CONFIRMED });
  return viewOf(ctx, after);
}

export type DryRunReport = { outcome: "done" | "stopped" | "failed"; summary?: string };

/**
 * The browser's report of a confirmed dry run draft (decision 8). Stored once in `result.report`; `noted_at` goes
 * back to null so the next chat turn tells Hermes the outcome. A second report replays the view.
 */
export async function reportDraft(ctx: BrowserCtx, draftId: string, report: DryRunReport): Promise<BuddyDraftView> {
  const row = await readMine(ctx, draftId);
  const result = (row.resultJson && typeof row.resultJson === "object" ? row.resultJson : {}) as Record<string, unknown>;
  if (row.kind !== "dryRun" || row.status !== "confirmed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This draft has no dry run to report." });
  }
  if ("report" in result) return viewOf(ctx, row);
  const stored = { outcome: report.outcome, ...(report.summary ? { summary: report.summary.slice(0, 300) } : {}) };
  const unreported: SQL = sql`json_extract(${buddyDraft.resultJson}, '$.report') is null`;
  const reported: SQL = sql`json_extract(${buddyDraft.resultJson}, '$.report.outcome') = ${report.outcome}`;
  const at = now();
  await atomicBatch(ctx.db, [
    ctx.db
      .update(buddyDraft)
      .set({ resultJson: { ...result, report: stored }, notedAt: null })
      .where(and(mine(ctx, draftId), eq(buddyDraft.status, "confirmed"), eq(buddyDraft.kind, "dryRun"), unreported)),
    auditInsertGuarded(
      ctx,
      { action: "buddy.draft.report", subjectType: "buddy_draft", subjectId: draftId, meta: { path: row.path, outcome: report.outcome, at: at.getTime() } },
      { from: buddyDraft, where: and(mine(ctx, draftId), reported, sql`not exists (select 1 from ${auditLog} where ${auditLog.subjectId} = ${draftId} and ${auditLog.action} = 'buddy.draft.report')`) },
    ),
  ]);
  return viewOf(ctx, await readMine(ctx, draftId));
}
