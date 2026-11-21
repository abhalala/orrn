/**
 * Tool leg: a mutation becomes a `buddy_draft` (design 2026-11-18, §4.4). Creating a draft writes the
 * draft row and its audit row and nothing else: no document number, ledger row, approval or print.
 *
 * The limit of 20 drafts an hour per person and plant is part of the INSERT itself (INSERT … SELECT … WHERE the
 * count of this person's drafts in the last hour is under 20), so parallel calls cannot pass it, and a new grant
 * does not start it again (fix round, security L2).
 */
import { buddyDraft, company, type BuddyDraftKind } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { auditInsertGuarded } from "../audit";
import { now } from "../clock";
import type { BuddyContext } from "./grantContext";

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const DRAFTS_PER_HOUR = 20;
const HOUR = 60 * 60 * 1000;

export type NewDraft = {
  /** Made by the caller first, so the input can be checked with the draft id as its request key. */
  id: string;
  path: string;
  kind: BuddyDraftKind;
  /** The input as Confirm will run it, minus what Confirm fills in (`expectSeq`, the request keys). */
  input: unknown;
  summary: string;
  /** `x-hermes-platform` of the MCP request (decision 1), when Hermes sent it. */
  originPlatform: string | null;
  /** Ingest drafts on a candidate: the candidate seq Confirm expects (delta S3). */
  basisSeq?: number | null;
};

/** Stores the draft unless the person made 20 in the last hour in this plant. False when the limit refused it. */
export async function createBuddyDraft(ctx: BuddyContext, draft: NewDraft): Promise<boolean> {
  const at = now().getTime();
  const companyId = ctx.companyId!;
  const userId = ctx.session!.user.id;
  const input = draft.input === undefined || draft.input === null ? null : JSON.stringify(draft.input);
  const platform = draft.originPlatform ? draft.originPlatform.slice(0, 40) : null;
  const underLimit = sql`(select count(*) from ${buddyDraft} where ${buddyDraft.companyId} = ${companyId} and ${buddyDraft.requestedByUserId} = ${userId} and ${buddyDraft.createdAt} > ${at - HOUR}) < ${DRAFTS_PER_HOUR}`;
  // Keys must match buddy_draft's columns, in table order (drizzle insert-select rule).
  const insert = ctx.db.insert(buddyDraft).select(
    ctx.db
      .select({
        id: sql<string>`${draft.id}`.as("id"),
        companyId: sql<string>`${company.id}`.as("company_id"),
        requestedByUserId: sql<string>`${userId}`.as("requested_by_user_id"),
        grantId: sql<string | null>`${ctx.buddyGrantId}`.as("grant_id"),
        path: sql<string>`${draft.path}`.as("path"),
        inputJson: sql<string | null>`${input}`.as("input_json"),
        summary: sql<string>`${draft.summary.slice(0, 300)}`.as("summary"),
        status: sql<string>`'pending'`.as("status"),
        createdAt: sql<number>`${at}`.as("created_at"),
        expiresAt: sql<number>`${at + DRAFT_TTL_MS}`.as("expires_at"),
        claimedAt: sql<number | null>`null`.as("claimed_at"),
        decidedBy: sql<string | null>`null`.as("decided_by"),
        decidedAt: sql<number | null>`null`.as("decided_at"),
        resultJson: sql<string | null>`null`.as("result_json"),
        failure: sql<string | null>`null`.as("failure"),
        originPlatform: sql<string | null>`${platform}`.as("origin_platform"),
        decidedVia: sql<string | null>`null`.as("decided_via"),
        notedAt: sql<number | null>`null`.as("noted_at"),
        kind: sql<string>`${draft.kind}`.as("kind"),
        basisSeq: sql<number | null>`${draft.basisSeq ?? null}`.as("basis_seq"),
      })
      .from(company)
      .where(and(eq(company.id, companyId), underLimit)),
  );
  const audit = auditInsertGuarded(
    ctx,
    {
      action: "buddy.draft.create",
      subjectType: "buddy_draft",
      subjectId: draft.id,
      meta: { path: draft.path, kind: draft.kind, grantId: ctx.buddyGrantId, ...(platform ? { platform } : {}) },
    },
    { from: buddyDraft, where: and(eq(buddyDraft.id, draft.id), eq(buddyDraft.companyId, companyId)) },
  );
  await ctx.db.batch([insert, audit]);
  const landed = await ctx.db
    .select({ id: buddyDraft.id })
    .from(buddyDraft)
    .where(and(eq(buddyDraft.id, draft.id), eq(buddyDraft.companyId, companyId)))
    .get();
  return !!landed;
}
