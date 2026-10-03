export const BUNDLE_STATUSES = ["available", "reserved", "dispatched", "void"] as const;
export const DISPATCH_STATUSES = ["draft", "reserved", "completed", "cancelled"] as const;

export type BundleStatus = (typeof BUNDLE_STATUSES)[number];
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];
export type StatusTone = "green" | "blue" | "amber" | "red" | "neutral";

const BUNDLE_TONES: Record<BundleStatus, StatusTone> = {
  available: "green",
  reserved: "blue",
  dispatched: "neutral",
  void: "red",
};

const DISPATCH_TONES: Record<DispatchStatus, StatusTone> = {
  draft: "amber",
  reserved: "blue",
  completed: "green",
  cancelled: "red",
};

export function bundleTone(status: BundleStatus): StatusTone {
  return BUNDLE_TONES[status];
}

export function dispatchTone(status: DispatchStatus): StatusTone {
  return DISPATCH_TONES[status];
}

/** Mirrors ALLOWED_DISPATCH_TRANSITIONS in packages/server/src/routers/dispatch.ts. */
export const DISPATCH_TRANSITIONS: Record<DispatchStatus, readonly DispatchStatus[]> = {
  draft: ["reserved", "cancelled"],
  reserved: ["draft", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export type DispatchActions = {
  canEdit: boolean;
  canReserve: boolean;
  canUnreserve: boolean;
  canComplete: boolean;
  canCancel: boolean;
  canDelete: boolean;
};

/** What the UI may offer for a dispatch in `status`. The server stays authoritative. */
export function dispatchActions(status: DispatchStatus): DispatchActions {
  const next = DISPATCH_TRANSITIONS[status];
  return {
    // Only draft dispatches can be edited (dispatch.update).
    canEdit: status === "draft",
    canReserve: next.includes("reserved"),
    // reserved -> draft is the only way back to draft.
    canUnreserve: status === "reserved" && next.includes("draft"),
    canComplete: next.includes("completed"),
    canCancel: next.includes("cancelled"),
    // Only draft or cancelled dispatches can be deleted (dispatch.delete).
    canDelete: status === "draft" || status === "cancelled",
  };
}
