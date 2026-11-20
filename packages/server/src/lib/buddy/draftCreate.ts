/**
 * Tool leg: a mutation becomes a `buddy_draft` (design 2026-11-18, §4.4). Creating a draft writes the
 * draft row and its audit row and nothing else: no document number, ledger row, approval or print.
 */
import { buddyDraft } from "@orrn/db/schema";

import { auditInsert } from "../audit";
import { now } from "../clock";
import { createId } from "../id";
import type { BuddyContext } from "./grantContext";
import { draftLink } from "./links";
import type { BuddyProcedure } from "./registry";

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export async function createBuddyDraft(
  ctx: BuddyContext,
  entry: BuddyProcedure,
  input: unknown,
): Promise<{ draftId: string; summary: string; link: string | null }> {
  const id = createId();
  const at = now();
  const summary = entry.description.slice(0, 300);
  await ctx.db.batch([
    ctx.db.insert(buddyDraft).values({
      id,
      companyId: ctx.companyId!,
      requestedByUserId: ctx.session!.user.id,
      grantId: ctx.buddyGrantId,
      path: entry.path,
      inputJson: input ?? null,
      summary,
      status: "pending",
      createdAt: at,
      expiresAt: new Date(at.getTime() + DRAFT_TTL_MS),
    }),
    auditInsert(ctx, {
      action: "buddy.draft.create",
      subjectType: "buddy_draft",
      subjectId: id,
      meta: { path: entry.path, grantId: ctx.buddyGrantId },
    }),
  ]);
  return { draftId: id, summary, link: draftLink(entry.path, input) };
}
