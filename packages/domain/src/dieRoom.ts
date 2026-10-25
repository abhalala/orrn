/**
 * Die room state machines (FP-DR-01/09/10/11/12/16; integration plan §2 shared names, C2/C4/C6/C43).
 * Pure rules: routers read rows, call these, and put the same condition in the write's WHERE.
 */

// ---------------------------------------------------------------------------
// Die copy status
// ---------------------------------------------------------------------------

/** Die copy (`die_instance`) status. `in_use` and `at_maker` are written only by issue and maker jobs. */
export const DIE_COPY_STATUSES = ["available", "in_use", "at_nitriding", "at_maker", "retired", "on_trial"] as const;
export type DieCopyStatus = (typeof DIE_COPY_STATUSES)[number];

export const DIE_COPY_EVENTS = [
  "issue",
  "issueReturn",
  "issueCancel",
  "nitridingOut",
  "nitridingBack",
  "makerSend",
  "makerReceive",
  "makerCancel",
  "retire",
  // Wave 2 (FP-DR-17, rank 42): a copy on trial until a die trial passes.
  "makerReceiveTrial", // back from the maker while dieRoom.newCopyOnTrial is on
  "trialIssue", // issued to a die_trial run (production issue refuses on_trial)
  "trialReturn", // the trial run's issue comes back without a pass
  "trialPass", // a logged die_trial run with trial_result pass
  "trialRelease", // manager + reason: available without a trial
  "trialToMaker", // failed trial: back to the maker
  "trialRetire", // failed trial: retired
  // W4-NEXTROWS (FP-DR-18): an in-house correction sends a rack copy back on trial.
  "workCorrect",
] as const;
export type DieCopyEvent = (typeof DIE_COPY_EVENTS)[number];

const COPY_MOVES: Record<DieCopyEvent, { from: DieCopyStatus; to: DieCopyStatus }> = {
  issue: { from: "available", to: "in_use" },
  issueReturn: { from: "in_use", to: "available" },
  issueCancel: { from: "in_use", to: "available" },
  nitridingOut: { from: "available", to: "at_nitriding" },
  nitridingBack: { from: "at_nitriding", to: "available" },
  makerSend: { from: "available", to: "at_maker" },
  makerReceive: { from: "at_maker", to: "available" },
  makerCancel: { from: "at_maker", to: "available" },
  // Retire only from the rack: never from in_use, at_nitriding or at_maker.
  retire: { from: "available", to: "retired" },
  makerReceiveTrial: { from: "at_maker", to: "on_trial" },
  trialIssue: { from: "on_trial", to: "in_use" },
  trialReturn: { from: "in_use", to: "on_trial" },
  trialPass: { from: "on_trial", to: "available" },
  trialRelease: { from: "on_trial", to: "available" },
  trialToMaker: { from: "on_trial", to: "at_maker" },
  trialRetire: { from: "on_trial", to: "retired" },
  workCorrect: { from: "available", to: "on_trial" },
};

/**
 * Status of a copy the die room creates or receives back from the maker (FP-DR-17):
 * `on_trial` while `company.settings.dieRoom.newCopyOnTrial` is on (default on), else `available`.
 */
export function newCopyStatus(settings: { dieRoom: { newCopyOnTrial: boolean } }): "on_trial" | "available" {
  return settings.dieRoom.newCopyOnTrial ? "on_trial" : "available";
}

/** The status after `event`, or null when the copy is not in the status the event needs. */
export function dieCopyNext(from: DieCopyStatus, event: DieCopyEvent): DieCopyStatus | null {
  const move = COPY_MOVES[event];
  return move.from === from ? move.to : null;
}

/** The status `event` needs (for the write's `WHERE status = ?`). */
export function dieCopyRequiredStatus(event: DieCopyEvent): DieCopyStatus {
  return COPY_MOVES[event].from;
}

/** Card fields (`dieInstance.update`) are refused while the copy is on a press or at the maker. */
export function canEditDieCard(status: DieCopyStatus): boolean {
  return status !== "in_use" && status !== "at_maker";
}

/** Statuses the card form may set by hand (never `in_use` / `at_maker`). */
export const DIE_COPY_HAND_STATUSES = ["available", "at_nitriding", "retired"] as const satisfies readonly DieCopyStatus[];

/** Permanent copy code `{sectionCode}-{seqNo}` (hyphen; a typed slash matches in search). */
export function dieCopyCode(sectionCode: string, seqNo: number): string {
  return `${sectionCode}-${seqNo}`;
}

/** Search text: `12170/2` and `12170-2` find the same copy. */
export function normalizeDieCopySearch(text: string): string {
  return text.trim().replace(/\//g, "-");
}

// ---------------------------------------------------------------------------
// Tier change and band lift (FP-DR-10)
// ---------------------------------------------------------------------------

export const TIER_CHANGE_STATUSES = ["pending", "applied", "rejected"] as const;
export type TierChangeStatus = (typeof TIER_CHANGE_STATUSES)[number];

export type TierChangePlan = {
  fromRank: number | null;
  toRank: number;
  fromBandId: string | null;
  /** Null with `isLift` = back to the section's primary band. */
  toBandId: string | null;
  isLift: boolean;
  /** Rank moved (a lift may keep the rank). */
  rankChanged: boolean;
};

export type TierChangeError = "nothing_changes" | "bad_rank" | "pending_exists";

/**
 * Plan one tier proposal. `lift: true` moves the copy to `toBandId` (a `die_band` id) or, with
 * `toBandId: null`, back to the primary band. A rank-only change leaves both band ids null.
 * One pending proposal per copy (rank or lift).
 */
export function planTierChange(input: {
  copy: { tierRank: number | null; bandId: string | null };
  toRank?: number | null;
  lift?: boolean;
  toBandId?: string | null;
  pendingExists?: boolean;
}): { ok: true; plan: TierChangePlan } | { ok: false; error: TierChangeError } {
  if (input.pendingExists) return { ok: false, error: "pending_exists" };
  const toRank = input.toRank ?? input.copy.tierRank;
  if (toRank == null || !Number.isInteger(toRank) || toRank < 1 || toRank > 99) return { ok: false, error: "bad_rank" };
  const isLift = input.lift === true;
  const toBandId = isLift ? (input.toBandId ?? null) : null;
  const rankChanged = toRank !== input.copy.tierRank;
  const bandChanged = isLift && toBandId !== input.copy.bandId;
  if (!rankChanged && !bandChanged) return { ok: false, error: "nothing_changes" };
  return {
    ok: true,
    plan: {
      fromRank: input.copy.tierRank,
      toRank,
      fromBandId: isLift ? input.copy.bandId : null,
      toBandId,
      isLift,
      rankChanged,
    },
  };
}

/** pending -> applied | rejected; decided rows never move again. */
export function tierChangeNext(from: TierChangeStatus, decision: "approved" | "rejected"): TierChangeStatus | null {
  if (from !== "pending") return null;
  return decision === "approved" ? "applied" : "rejected";
}

// ---------------------------------------------------------------------------
// Ownership (FP-DR-12, C1/C2/C4/C47)
// ---------------------------------------------------------------------------

/** Approval kind `die_owner_override`: `meta.purpose`. Informational; the grant is per customer + copy. */
export const DIE_OWNER_OVERRIDE_PURPOSES = ["plan", "press", "pack", "dispatch"] as const;
export type DieOwnerOverridePurpose = (typeof DIE_OWNER_OVERRIDE_PURPOSES)[number];

/** Copy owner if set, else section owner, else null (plant-owned: everything passes). */
export function effectiveDieOwner(copyOwnerId: string | null | undefined, sectionOwnerId: string | null | undefined): string | null {
  return copyOwnerId ?? sectionOwnerId ?? null;
}

/**
 * Why a die may not be used for a customer. `pick_copy`: the section is owned and no copy is
 * chosen. `no_copies`: owned section without copies. `owned`: the effective owner is someone else
 * (or the material is plant stock) and no live grant covers it.
 */
export type DieOwnerBlock = "pick_copy" | "no_copies" | "owned";

export type DieOwnerDecision =
  | { ok: true; ownerCustomerId: string | null; viaGrant: boolean }
  | { ok: false; block: DieOwnerBlock; ownerCustomerId: string | null };

/**
 * The ownership gate shared by plan, press, pack and dispatch (`lib/dieOwner.ts` reads the rows,
 * this decides). `customerId` null = plant stock, which an owned die never passes without a grant.
 * A grant is an approved `die_owner_override` on this copy for this customer that is not closed.
 */
export function decideDieOwner(input: {
  sectionOwnerId: string | null;
  sectionCopyCount: number;
  /** Some copy of the section has its own owner (a copy-level owner under an unowned section). */
  anyCopyOwned?: boolean;
  copy: { ownerCustomerId: string | null } | null;
  customerId: string | null;
  hasLiveGrant: boolean;
}): DieOwnerDecision {
  const sectionOwned = input.sectionOwnerId !== null;
  if (!input.copy) {
    // Spec PK §4 step 3: an owned die needs a named copy, whoever the customer is.
    if (!sectionOwned && !input.anyCopyOwned) return { ok: true, ownerCustomerId: null, viaGrant: false };
    if (input.sectionCopyCount === 0) return { ok: false, block: "no_copies", ownerCustomerId: input.sectionOwnerId };
    return { ok: false, block: "pick_copy", ownerCustomerId: input.sectionOwnerId };
  }
  const owner = effectiveDieOwner(input.copy.ownerCustomerId, input.sectionOwnerId);
  if (owner === null || owner === input.customerId) return { ok: true, ownerCustomerId: owner, viaGrant: false };
  if (input.hasLiveGrant && input.customerId !== null) return { ok: true, ownerCustomerId: owner, viaGrant: true };
  return { ok: false, block: "owned", ownerCustomerId: owner };
}

// ---------------------------------------------------------------------------
// Die issue (FP-DR-16, C6, C43)
// ---------------------------------------------------------------------------

/** `die_issue.status`. No document number: the copy code is the identity. */
export const DIE_ISSUE_STATUSES = ["issued", "returned", "cancelled"] as const;
export type DieIssueStatus = (typeof DIE_ISSUE_STATUSES)[number];

export type IssueRefusal =
  | "copy_not_available"
  | "copy_on_trial"
  | "open_issue_exists"
  | "run_not_queued"
  | "section_mismatch"
  | "line_mismatch";

/**
 * Issue a copy to a press line (and a queued run). One batch: issue row `issued`, copy `in_use`,
 * `press_run.die_instance_id` = copy, run `queued -> die_issued`.
 */
export function canIssueDie(input: {
  copy: { status: DieCopyStatus; sectionId: string };
  openIssueForCopy: boolean;
  pressLineId: string;
  run?: { status: string; sectionId: string; pressLineId: string | null } | null;
  /**
   * Wave 2 (FP-DR-17 / PR-23): the plan purpose of the run. An `on_trial` copy issues only to a
   * `die_trial` run (event `trialIssue`); every other purpose refuses it with `copy_on_trial`.
   */
  purpose?: "production" | "die_trial" | "sample" | "other";
}): { ok: true } | { ok: false; refusal: IssueRefusal } {
  if (input.openIssueForCopy) return { ok: false, refusal: "open_issue_exists" };
  if (input.copy.status === "on_trial") {
    if (input.purpose !== "die_trial") return { ok: false, refusal: "copy_on_trial" };
  } else if (input.copy.status !== "available") return { ok: false, refusal: "copy_not_available" };
  const run = input.run;
  if (run) {
    if (run.status !== "queued") return { ok: false, refusal: "run_not_queued" };
    if (run.sectionId !== input.copy.sectionId) return { ok: false, refusal: "section_mismatch" };
    if (run.pressLineId !== null && run.pressLineId !== input.pressLineId) return { ok: false, refusal: "line_mismatch" };
  }
  return { ok: true };
}

export type ReturnRefusal = "not_issued" | "die_on_press";

/**
 * Return a copy to the rack: refused while the die is in (started) and not yet out (C43). A
 * finished run keeps its copy; return never moves the run status back.
 */
export function canReturnDie(input: {
  issueStatus: DieIssueStatus;
  run?: { dieInAt: number | null; dieOutAt: number | null } | null;
}): { ok: true } | { ok: false; refusal: ReturnRefusal } {
  if (input.issueStatus !== "issued") return { ok: false, refusal: "not_issued" };
  if (input.run && input.run.dieInAt != null && input.run.dieOutAt == null) return { ok: false, refusal: "die_on_press" };
  return { ok: true };
}

/** Cancel only before die-in, while the run is `die_issued`: copy back to available, run back to queued. */
export function canCancelIssue(input: {
  issueStatus: DieIssueStatus;
  run?: { status: string; dieInAt: number | null } | null;
}): boolean {
  if (input.issueStatus !== "issued") return false;
  if (!input.run) return true;
  return input.run.status === "die_issued" && input.run.dieInAt == null;
}

/**
 * C43: when a run is logged, its issue returns by itself unless the next queued run on the same
 * line uses the same copy (then the issue stays open and that run becomes `die_issued`).
 */
export function issueAfterLog(input: { copyId: string; nextQueuedRunCopyId: string | null | undefined }): "return" | "carry_to_next" {
  return input.nextQueuedRunCopyId === input.copyId ? "carry_to_next" : "return";
}

/**
 * FP-DR-18 die work log (W4-NEXTROWS): whether work may be logged on a copy, and what it does to the
 * status. Work is done on the rack: an `available` or `on_trial` copy. A copy on a press, at the
 * maker, out at nitriding or retired is refused. `setOnTrial` is for a correction (`correct`) only;
 * on an available copy it moves it to `on_trial` (event `workCorrect`); a copy already on trial
 * stays there. No stock moves.
 */
export type DieWorkRefusal = "copy_in_use" | "copy_at_maker" | "copy_at_nitriding" | "copy_retired" | "trial_needs_correct";

export const DIE_WORK_STATUSES = ["available", "on_trial"] as const satisfies readonly DieCopyStatus[];

export function dieWorkCheck(input: { status: DieCopyStatus; code: string; setOnTrial?: boolean }):
  | { ok: true; nextStatus: DieCopyStatus; movesToTrial: boolean }
  | { ok: false; refusal: DieWorkRefusal } {
  switch (input.status) {
    case "in_use":
      return { ok: false, refusal: "copy_in_use" };
    case "at_maker":
      return { ok: false, refusal: "copy_at_maker" };
    case "at_nitriding":
      return { ok: false, refusal: "copy_at_nitriding" };
    case "retired":
      return { ok: false, refusal: "copy_retired" };
    default:
      break;
  }
  if (input.setOnTrial && input.code !== "correct") return { ok: false, refusal: "trial_needs_correct" };
  const to = input.setOnTrial ? dieCopyNext(input.status, "workCorrect") : null;
  return { ok: true, nextStatus: to ?? input.status, movesToTrial: to !== null };
}
