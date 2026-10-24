import type { DispatchStatus } from "@orrn/domain";

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
  if (bundles === 0) return perms.addBundle ? { primary: "scan", secondary: [] } : none;
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
