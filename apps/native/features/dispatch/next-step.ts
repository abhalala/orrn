import type { DispatchStatus } from "@orrn/domain";
import { dispatchActions } from "@orrn/domain";
import { can } from "@orrn/server/lib/permissions";

export type StepPerms = { addBundle: boolean; reserve: boolean; complete: boolean };

export type NextStep = {
  /** The one large button in the bottom bar. */
  primary: "scan" | "hold" | "dispatch" | null;
  /** Smaller buttons above it. */
  secondary: ("hold" | "release")[];
};

/**
 * What the bottom bar offers. An empty dispatch asks for bundles first.
 * Someone who can complete gets Dispatch as the main button (from Building it
 * holds the stock first, ruling T22, so it also needs the right to hold);
 * someone who can only hold gets Hold stock. Hold and Release sit beside it.
 * The server stays the judge: this only decides what to show.
 */
export function nextStep(status: DispatchStatus, bundles: number, perms: StepPerms): NextStep {
  const none: NextStep = { primary: null, secondary: [] };
  if (status !== "draft" && status !== "reserved") return none;
  if (bundles === 0) {
    // Web keeps Release on an empty held dispatch (only Dispatch is disabled), so it stays here too.
    const release: NextStep["secondary"] = status === "reserved" && perms.reserve ? ["release"] : [];
    return { primary: perms.addBundle ? "scan" : null, secondary: release };
  }
  if (status === "draft") {
    if (perms.complete && perms.reserve) return { primary: "dispatch", secondary: ["hold"] };
    return perms.reserve ? { primary: "hold", secondary: [] } : none;
  }
  return {
    primary: perms.complete ? "dispatch" : null,
    secondary: perms.reserve ? ["release"] : [],
  };
}

/** Which step is current: Build while building, Hold while held, past the last once dispatched. -1 for cancelled. */
export function currentStep(status: DispatchStatus): number {
  switch (status) {
    case "draft":
      return 0;
    case "reserved":
      return 1;
    case "completed":
      return 3;
    default:
      return -1;
  }
}

/**
 * Everything the bottom bar would show, in order, for this step. The bar renders
 * whenever this is not empty: a packer on a held dispatch has Release but no primary.
 */
export function barActions(step: NextStep): ("scan" | "hold" | "release" | "dispatch")[] {
  return [...step.secondary, ...(step.primary ? [step.primary] : [])];
}

/** True when the bar has anything to show. */
export function showsActionBar(step: NextStep): boolean {
  return barActions(step).length > 0;
}

/**
 * The role's rights for the bar, from the same matrix as the web dispatch screen
 * (`dispatch.addBundle`, `dispatch.reserve`, `dispatch.complete`), narrowed by what
 * the status allows.
 */
export function stepPerms(me: Parameters<typeof can>[0], status: DispatchStatus): StepPerms {
  const actions = dispatchActions(status);
  return {
    addBundle: can(me, "dispatch.addBundle"),
    reserve: can(me, "dispatch.reserve") && (actions.canReserve || actions.canUnreserve),
    // From Building, Dispatch holds first (ruling T22), so a draft counts as completable here;
    // nextStep still requires the right to hold. Same as the web `dispatchButton`.
    complete: can(me, "dispatch.complete") && (actions.canComplete || actions.canReserve),
  };
}
