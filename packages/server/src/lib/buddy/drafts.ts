/**
 * Confirm-first writes, browser side (design 2026-11-18, §4.4, §7, §10, §12).
 *
 * `confirmDraft` runs only from `buddy.drafts.confirm`, under the browser request's own context:
 * - it re-reads the draft (this company, this person, pending, unexpired) and re-decides its path, so a
 *   draft row that names a denied path can never run;
 * - it claims the draft with a conditional UPDATE before running, so two confirms never both run it;
 * - it runs the procedure through `appRouter.createCaller({ ...ctx, buddyDraftId })`, so every rule of the
 *   real procedure (`can()`, module gate, balances, `expectSeq`, the plant's model caps) applies as that
 *   person, and the procedure's own audit row carries `meta.buddyDraftId`;
 * - the draft id is the `clientRequestId` (or `clientMutationId`) where the target takes one;
 * - a confirmed draft's stored result is the answer to every later confirm (replay).
 */
import { TRPCError } from "@trpc/server";
import { buddyDraft } from "@orrn/db/schema";
import { and, desc, eq, isNull, lt, ne, or } from "drizzle-orm";

import type { Context } from "../../context";
import { atomicBatch } from "../atomic";
import { auditInsert } from "../audit";
import { now } from "../clock";
import { refusedInput } from "./decisions";
import { draftView, type DraftRow } from "./draftView";
import { capResult } from "./envelope";
import { allowedProcedure, validateInput, type BuddyProcedure } from "./registry";
import type { BuddyDraftView } from "./views";

type BrowserCtx = Context & { companyId: string; session: NonNullable<Context["session"]> };

/** A claim older than this is a confirm that died mid-run; a new confirm may take it over. */
export const DRAFT_CLAIM_STALE_MS = 2 * 60 * 1000;
const DECIDED_SHOWN = 20;

const draftColumns = {
  id: buddyDraft.id,
  path: buddyDraft.path,
  inputJson: buddyDraft.inputJson,
  status: buddyDraft.status,
  createdAt: buddyDraft.createdAt,
  expiresAt: buddyDraft.expiresAt,
  resultJson: buddyDraft.resultJson,
  failure: buddyDraft.failure,
};

function mine(ctx: BrowserCtx, draftId: string) {
  return and(
    eq(buddyDraft.companyId, ctx.companyId),
    eq(buddyDraft.requestedByUserId, ctx.session.user.id),
    eq(buddyDraft.id, draftId),
  );
}

async function readMine(ctx: BrowserCtx, draftId: string): Promise<DraftRow> {
  const row = await ctx.db.select(draftColumns).from(buddyDraft).where(mine(ctx, draftId)).get();
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  return row;
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
  const at = now();
  return [...pending, ...decided].map((r) => draftView(r, at));
}

/** Mark a pending draft decided (conditional on it still being pending) with its audit row. */
async function settle(
  ctx: BrowserCtx,
  row: DraftRow,
  set: { status: "confirmed" | "rejected" | "expired" | "failed"; resultJson?: unknown; failure?: string | null },
  action: string,
): Promise<void> {
  const at = now();
  await atomicBatch(ctx.db, [
    ctx.db
      .update(buddyDraft)
      .set({ ...set, decidedBy: ctx.session.user.id, decidedAt: at })
      .where(and(mine(ctx, row.id), eq(buddyDraft.status, "pending"))),
    auditInsert(ctx, {
      action,
      subjectType: "buddy_draft",
      subjectId: row.id,
      meta: { path: row.path, ...(set.failure ? { failure: set.failure } : {}) },
    }),
  ]);
}

function withRequestId(entry: BuddyProcedure, input: unknown, draftId: string): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  for (const key of ["clientRequestId", "clientMutationId"] as const) {
    if (!entry.fields.includes(key) || (input as Record<string, unknown>)[key] !== undefined) continue;
    const candidate = { ...(input as Record<string, unknown>), [key]: draftId };
    if (validateInput(entry, candidate).ok) return candidate;
  }
  return input;
}

function failureText(error: unknown): string {
  if (error instanceof TRPCError) return error.message;
  if (error instanceof Error) return error.message;
  return "The change failed.";
}

/** Run the procedure at `path` (already decided "allow" and present in the registry) with `input`. */
async function runOnCaller(ctx: BrowserCtx, path: string, input: unknown, draftId: string): Promise<unknown> {
  const { appRouter } = await import("../../routers/index");
  const caller = appRouter.createCaller({ ...ctx, buddyDraftId: draftId });
  let target: unknown = caller;
  for (const segment of path.split(".")) target = (target as Record<string, unknown>)[segment];
  if (typeof target !== "function") throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  return (target as (i: unknown) => Promise<unknown>)(input);
}

export async function confirmDraft(ctx: BrowserCtx, draftId: string): Promise<BuddyDraftView> {
  const row = await readMine(ctx, draftId);
  // Decided already: the stored outcome is the answer (a second confirm replays the result).
  if (row.status !== "pending") return draftView(row);
  const at = now();
  if (row.expiresAt.getTime() <= at.getTime()) {
    await settle(ctx, row, { status: "expired" }, "buddy.draft.expire");
    return draftView(await readMine(ctx, draftId));
  }

  const entry = await allowedProcedure(row.path);
  const refused = entry ? refusedInput(entry.decision, row.inputJson) : "Not allowed for the buddy.";
  if (!entry || refused) {
    await settle(ctx, row, { status: "failed", failure: "The buddy may not make this change." }, "buddy.draft.fail");
    return draftView(await readMine(ctx, draftId));
  }

  // Claim: only one confirm runs the draft. A lost race re-reads and answers what the winner stored.
  const claimed = await ctx.db
    .update(buddyDraft)
    .set({ claimedAt: at })
    .where(
      and(
        mine(ctx, draftId),
        eq(buddyDraft.status, "pending"),
        or(isNull(buddyDraft.claimedAt), lt(buddyDraft.claimedAt, new Date(at.getTime() - DRAFT_CLAIM_STALE_MS))),
      ),
    )
    .returning({ id: buddyDraft.id });
  if (claimed.length === 0) {
    const again = await readMine(ctx, draftId);
    if (again.status !== "pending") return draftView(again);
    throw new TRPCError({ code: "CONFLICT", message: "This draft is being confirmed." });
  }

  const input = withRequestId(entry, row.inputJson, row.id);
  try {
    const result = await runOnCaller(ctx, entry.path, input, row.id);
    const capped = capResult(result);
    await settle(ctx, row, { status: "confirmed", resultJson: capped.data ?? null }, "buddy.draft.confirm");
  } catch (error) {
    await settle(ctx, row, { status: "failed", failure: failureText(error) }, "buddy.draft.fail");
  }
  return draftView(await readMine(ctx, draftId));
}

export async function rejectDraft(ctx: BrowserCtx, draftId: string): Promise<BuddyDraftView> {
  const row = await readMine(ctx, draftId);
  if (row.status === "pending") await settle(ctx, row, { status: "rejected" }, "buddy.draft.reject");
  return draftView(await readMine(ctx, draftId));
}
