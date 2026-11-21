/**
 * `buddy.drafts.*` (design 2026-11-18, §4.4): the person's drafts, confirmed or rejected under their own browser
 * session. Split from `buddy.ts` so the drafts and the grants can change apart. Same guard: `buddyProcedure`.
 */
import { z } from "zod";

import { router } from "../index";
import { confirmDraft, listMyDrafts, rejectDraft } from "../lib/buddy/drafts";
import type { BuddyDraftView } from "../lib/buddy/views";
import { buddyProcedure } from "./buddyProcedure";

const draftIdInput = z.strictObject({ draftId: z.string().min(1).max(64) });

export const buddyDraftsRouter = router({
  /** The person's pending drafts and their last 20 decided ones. */
  listMine: buddyProcedure.query(({ ctx }): Promise<BuddyDraftView[]> => listMyDrafts(ctx)),
  /** Runs the draft's procedure under this request's own session; a second confirm replays the result. */
  confirm: buddyProcedure.input(draftIdInput).mutation(({ ctx, input }): Promise<BuddyDraftView> => confirmDraft(ctx, input.draftId)),
  reject: buddyProcedure.input(draftIdInput).mutation(({ ctx, input }): Promise<BuddyDraftView> => rejectDraft(ctx, input.draftId)),
});
