/**
 * `buddy.drafts.*` (design 2026-11-18, §4.4): the person's drafts, confirmed or rejected under their own browser
 * session. Split from `buddy.ts` so the drafts and the grants can change apart. Same guard: `buddyProcedure`.
 */
import { z } from "zod";

import { router } from "../index";
import { confirmDraft, listMyDrafts, rejectDraft, reportDraft } from "../lib/buddy/drafts";
import type { BuddyDraftView } from "../lib/buddy/views";
import { buddyProcedure } from "./buddyProcedure";

const draftId = z.string().min(1).max(64);
/** Where the person decided: the bubble's card or Settings > Buddy (stored as `decided_via`). */
const decideInput = z.strictObject({ draftId, via: z.enum(["bubble", "settings"]) });
const reportInput = z.strictObject({
  draftId,
  outcome: z.enum(["done", "stopped", "failed"]),
  summary: z.string().trim().max(300).optional(),
});

export const buddyDraftsRouter = router({
  /** The person's pending drafts and their last 20 decided ones. */
  listMine: buddyProcedure.query(({ ctx }): Promise<BuddyDraftView[]> => listMyDrafts(ctx)),
  /** Runs the draft under this request's own session, at most once; a second confirm replays the result. */
  confirm: buddyProcedure.input(decideInput).mutation(({ ctx, input }): Promise<BuddyDraftView> => confirmDraft(ctx, input.draftId, input.via)),
  /** Refused (CONFLICT) while a confirm holds the draft. */
  reject: buddyProcedure.input(decideInput).mutation(({ ctx, input }): Promise<BuddyDraftView> => rejectDraft(ctx, input.draftId, input.via)),
  /** The browser's outcome of a confirmed dry run draft (decision 8); the next chat turn tells Hermes. */
  report: buddyProcedure
    .input(reportInput)
    .mutation(({ ctx, input }): Promise<BuddyDraftView> => reportDraft(ctx, input.draftId, { outcome: input.outcome, ...(input.summary ? { summary: input.summary } : {}) })),
});
