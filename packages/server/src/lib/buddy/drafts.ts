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
 *   ingest draft on a candidate runs only on the seq it was drafted for (`basis_seq`, after the earlier drafts of its
 *   turn ran); any other change to the candidate settles it `failed` with STALE_DRAFT_FAILURE (delta S3);
 * - an irreversible draft with an unnamed id or bidi controls is refused before the claim (`confirmBlock`, delta S4);
 * - a stored result never holds a secret (`stripSecrets`, delta decision 1);
 * - an audit row is written only when the settling UPDATE matched (same batch, guarded INSERT … SELECT);
 * - a decided draft's stored outcome is the answer to every later confirm (replay).
 */
import { auditLog, buddyDraft, buddyGrant, type BuddyDraftDecidedVia } from "@orrn/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { ZodError } from "zod";

import type { Context } from "../../context";
import { atomicBatch } from "../atomic";
import { auditInsertGuarded } from "../audit";
import { now } from "../clock";
import { refusedInput } from "./decisions";
import { resolveDraftNames } from "./draftNames";
import { draftView, fillsExpectSeq, KIND_TARGET, REQUEST_KEYS, type DraftRow } from "./draftView";
import { capResult, stripSecrets } from "./envelope";
import { allowedProcedure, roleHoldsGuard, validateInput, type BuddyProcedure } from "./registry";
import { TRPCMetaError } from "../errorMeta";
import { CONFIRM_BLOCKED, type BuddyDraftView } from "./views";

type BrowserCtx = Context & { companyId: string; session: NonNullable<Context["session"]> };

/** A claim older than this is a confirm that died mid-run. It is never run again (decision 6). */
export const DRAFT_CLAIM_STALE_MS = 2 * 60 * 1000;
/**
 * Slow targets keep their claim longer (review N3), so a second Confirm or Reject does not call a confirm that is still
 * running "could not tell": a paid page read, and a batch of up to 30 import answers in one request.
 */
const CLAIM_STALE_BY_TARGET: Record<string, number> = {
  "ingest.vision.readPage": 15 * 60 * 1000,
  "import.answerQuestions": 5 * 60 * 1000,
};
export const claimStaleMs = (path: string): number => CLAIM_STALE_BY_TARGET[path] ?? DRAFT_CLAIM_STALE_MS;
/** The draft's candidate changed after it was drafted, other than by the earlier drafts of its turn (delta S3). */
export const STALE_DRAFT_FAILURE = "The sheet changed after this was drafted. Ask Buddy again.";
export const CONFIRM_BLOCKED_TEXT = "This change cannot be undone and the card cannot show it plainly, so it cannot be confirmed here. Reject it, or make the change on its screen.";
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
  basisSeq: buddyDraft.basisSeq,
};
type Row = DraftRow & { claimedAt: Date | null; grantId: string | null; basisSeq: number | null };

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

/** Names for the ids the cards show (decisions 9 and delta 5). Only this plant's rows (`draftNames.ts`). */
const namesFor = (ctx: BrowserCtx, rows: Row[]) => resolveDraftNames(ctx, rows);

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
  // Decision 1: a stored result never holds a token, a share link or a signed link.
  const safe = set.resultJson === undefined ? set : { ...set, resultJson: stripSecrets(set.resultJson) };
  await atomicBatch(ctx.db, [
    ctx.db
      .update(buddyDraft)
      .set({ ...safe, decidedBy: userId, decidedAt: at, decidedVia: via })
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

const stale = (row: Row, claimedAt: Date, at: Date) => claimedAt.getTime() < at.getTime() - claimStaleMs(row.path);

/**
 * The common start of Confirm and Reject. Returns the view when the draft is already decided or was settled here
 * (stale claim, lapsed); throws CONFLICT while a confirm holds a fresh claim; else null (go on).
 */
async function settleIfDone(ctx: BrowserCtx, row: Row, via: BuddyDraftDecidedVia): Promise<BuddyDraftView | null> {
  if (row.status !== "pending") return viewOf(ctx, row);
  const at = now();
  if (row.claimedAt) {
    if (!stale(row, row.claimedAt, at)) throw new TRPCError({ code: "CONFLICT", message: BEING_CONFIRMED });
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

class StaleDraft extends Error {
  constructor() {
    super("stale draft");
  }
}
const candidateNow = (caller: Caller, candidateId: string) => callPath(caller, "ingest.candidate.get", { candidateId }) as Promise<CandidateNow>;

/** The input as Confirm runs it: the draft id as request key, the candidate's current expectSeq (decision 8, S3). */
async function runInput(ctx: BrowserCtx, caller: Caller, entry: BuddyProcedure, row: Row): Promise<unknown> {
  const input = row.inputJson;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const key of REQUEST_KEYS) if (entry.fields.includes(key)) out[key] = row.id;
  if (entry.fields.includes("expectSeq") && fillsExpectSeq(entry.path, input)) {
    out.expectSeq = await seqIfCurrent(ctx, caller, row, out.candidateId as string);
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

/**
 * The candidate's current seq when it is the one the draft expects (delta S3, decision 4): `basis_seq`, and every draft
 * on the same candidate that was pending when this one was made is now confirmed (the earlier drafts of its turn ran).
 * Anything else moved the candidate (the person on the review page, another tab, a draft rejected or failed): throws.
 */
async function seqIfCurrent(ctx: BrowserCtx, caller: Caller, row: Row, candidateId: string): Promise<number> {
  const seq = (await candidateNow(caller, candidateId)).serverSeq;
  // Every such draft is made with a basis (0054 is new): a draft without one cannot be checked, so it never runs.
  if (row.basisSeq === null || row.basisSeq === undefined) throw new StaleDraft();
  if (seq !== row.basisSeq) throw new StaleDraft();
  const earlier = await ctx.db
    .select({ status: buddyDraft.status })
    .from(buddyDraft)
    .where(
      and(
        eq(buddyDraft.companyId, ctx.companyId),
        eq(buddyDraft.requestedByUserId, ctx.session.user.id),
        ne(buddyDraft.id, row.id),
        isNotNull(buddyDraft.basisSeq),
        sql`json_extract(${buddyDraft.inputJson}, '$.candidateId') = ${candidateId}`,
        or(lt(buddyDraft.createdAt, row.createdAt), and(eq(buddyDraft.createdAt, row.createdAt), lt(buddyDraft.id, row.id))),
        or(isNull(buddyDraft.decidedAt), sql`${buddyDraft.decidedAt} > ${row.createdAt.getTime()}`),
        sql`${buddyDraft.expiresAt} > ${row.createdAt.getTime()}`,
      ),
    );
  if (earlier.some((e) => e.status !== "confirmed")) throw new StaleDraft();
  return seq;
}

/** kind "answers": `ingest.answer.set` for each answer, in order, with the current expectSeq each time. */
async function runAnswers(ctx: BrowserCtx, caller: Caller, entry: BuddyProcedure, row: Row): Promise<unknown> {
  const { candidateId, answers } = row.inputJson as { candidateId: string; answers: { questionCode: string; subject: string; answer: unknown }[] };
  let applied = 0;
  let candidate: unknown = null;
  // The first answer runs only on the seq the draft expects; then each answer.set hands back the next one.
  let seq: number | null = await seqIfCurrent(ctx, caller, row, candidateId);
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

/** The draft's grant is neither revoked nor past `expires_at` (null: no expiry, as `grantContext` reads it; D-L1). */
async function grantLive(ctx: BrowserCtx, grantId: string | null): Promise<boolean> {
  if (!grantId) return false;
  const g = await ctx.db
    .select({ revokedAt: buddyGrant.revokedAt, expiresAt: buddyGrant.expiresAt })
    .from(buddyGrant)
    .where(and(eq(buddyGrant.id, grantId), eq(buddyGrant.companyId, ctx.companyId)))
    .get();
  if (!g || g.revokedAt !== null) return false;
  return !g.expiresAt || g.expiresAt.getTime() > now().getTime();
}

export async function confirmDraft(ctx: BrowserCtx, draftId: string, via: BuddyDraftDecidedVia): Promise<BuddyDraftView> {
  const row = await readMine(ctx, draftId);
  const done = await settleIfDone(ctx, row, via);
  if (done) return done;

  // Security L1, D-L1: a draft of a grant that was cut off or ran out never runs.
  if (!(await grantLive(ctx, row.grantId))) {
    await settle(ctx, row, { status: "expired" }, "buddy.draft.expire", via, null);
    return viewOf(ctx, await readMine(ctx, draftId));
  }
  const entry = await decided(ctx, row);
  if (!entry) {
    await settle(ctx, row, { status: "failed", failure: NOT_ALLOWED }, "buddy.draft.fail", via, null);
    return viewOf(ctx, await readMine(ctx, draftId));
  }
  // Decisions 5 and 10: an irreversible draft the card cannot show plainly is refused; the draft stays pending.
  const view = await viewOf(ctx, row);
  if (view.confirmBlock) {
    throw new TRPCMetaError({ code: "PRECONDITION_FAILED", message: CONFIRM_BLOCKED_TEXT, meta: { reason: CONFIRM_BLOCKED, keys: view.confirmBlock.keys, why: view.confirmBlock.reason } });
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
    if (row.kind === "answers") result = await runAnswers(ctx, caller, entry, row);
    else if (row.kind === "dryRun") result = await startDryRun(caller, row);
    else result = await callPath(caller, entry.path, await runInput(ctx, caller, entry, row));
    const capped = capResult(stripSecrets(result));
    await settle(ctx, row, { status: "confirmed", resultJson: capped.data ?? null }, "buddy.draft.confirm", via, claim);
  } catch (error) {
    if (error instanceof StaleDraft) {
      await settle(ctx, row, { status: "failed", failure: STALE_DRAFT_FAILURE }, "buddy.draft.fail", via, claim);
    } else if (error instanceof AnswersStopped) {
      await settle(
        ctx,
        row,
        { status: "failed", failure: failureText(error.inner), resultJson: { applied: { done: error.applied, total: error.total } } },
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

/** The stored outcome from the candidate's own state (delta S2): ready or held is done, processing stopped, else failed. */
export function dryRunOutcome(state: string): "done" | "stopped" | "failed" {
  if (state === "ready" || state === "held") return "done";
  if (state === "processing") return "stopped";
  return "failed";
}

/**
 * The browser's report of a confirmed dry run draft (decision 8, delta S2). The report only triggers a read: the
 * server stores `result.dryRun = { outcome, state }` from the candidate's own state at that moment, never the
 * browser's outcome or summary. Stored once; `noted_at` goes back to null so the next chat turn tells Hermes. A
 * second report replays the view.
 */
export async function reportDraft(ctx: BrowserCtx, draftId: string, _report: DryRunReport): Promise<BuddyDraftView> {
  const row = await readMine(ctx, draftId);
  const result = (row.resultJson && typeof row.resultJson === "object" ? row.resultJson : {}) as Record<string, unknown>;
  if (row.kind !== "dryRun" || row.status !== "confirmed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This draft has no dry run to report." });
  }
  if ("dryRun" in result) return viewOf(ctx, row);
  const { candidateId } = row.inputJson as { candidateId: string };
  const caller = await callerFor(ctx, row.id);
  let state: string;
  try {
    state = (await candidateNow(caller, candidateId)).state;
  } catch (error) {
    // A candidate the person can no longer read (gone) is a failed run, never "done".
    if (error instanceof TRPCError && error.code === "NOT_FOUND") state = "gone";
    else throw error;
  }
  const stored = { outcome: dryRunOutcome(state), state };
  const unreported: SQL = sql`json_extract(${buddyDraft.resultJson}, '$.dryRun') is null`;
  const reported: SQL = sql`json_extract(${buddyDraft.resultJson}, '$.dryRun.outcome') = ${stored.outcome}`;
  const at = now();
  await atomicBatch(ctx.db, [
    ctx.db
      .update(buddyDraft)
      .set({ resultJson: stripSecrets({ ...result, dryRun: stored }), notedAt: null })
      .where(and(mine(ctx, draftId), eq(buddyDraft.status, "confirmed"), eq(buddyDraft.kind, "dryRun"), unreported)),
    auditInsertGuarded(
      ctx,
      { action: "buddy.draft.report", subjectType: "buddy_draft", subjectId: draftId, meta: { path: row.path, outcome: stored.outcome, state, at: at.getTime() } },
      { from: buddyDraft, where: and(mine(ctx, draftId), reported, sql`not exists (select 1 from ${auditLog} where ${auditLog.subjectId} = ${draftId} and ${auditLog.action} = 'buddy.draft.report')`) },
    ),
  ]);
  return viewOf(ctx, await readMine(ctx, draftId));
}
