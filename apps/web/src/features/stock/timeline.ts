import type { BundleStatus } from "@orrn/domain";

/** A row of `bundle_status_event` as `bundle.getBySerial` returns it (dates arrive as ISO strings). */
export type StatusEvent = {
  id: string;
  fromStatus: BundleStatus | null;
  toStatus: BundleStatus;
  reason: string | null;
  dispatchId: string | null;
  at: string | number | Date;
  /** Who did it (the user's name); null once that user is deleted. */
  actorName?: string | null;
};

export type TimelineKind = "packed" | "imported" | "held" | "released" | "dispatched" | "voided" | "restored" | "changed";

export type TimelineEntry = {
  id: string;
  kind: TimelineKind;
  /** Status after the event, for its colour and word. */
  status: BundleStatus;
  at: Date;
  /** What a person typed (void or restore reason, cancel reason). System reasons are never notes. */
  note: string | null;
  dispatchId: string | null;
  /** Who did it, when the server says. */
  actorName: string | null;
};

/** Reasons the server writes itself (`receipt`, `legacy-import`, `dispatch.*`). */
function isSystemReason(reason: string | null): boolean {
  return !reason || reason === "receipt" || reason === "legacy-import" || reason.startsWith("dispatch.");
}

function kindOf(e: StatusEvent): TimelineKind {
  if (e.reason === "legacy-import") return "imported";
  if (e.fromStatus === null || e.reason === "receipt") return "packed";
  if (e.toStatus === "reserved") return "held";
  if (e.toStatus === "dispatched") return "dispatched";
  if (e.toStatus === "void") return "voided";
  if (e.fromStatus === "void" && e.toStatus === "available") return "restored";
  if (e.fromStatus === "reserved" && e.toStatus === "available") return "released";
  return "changed";
}

/**
 * The bundle's history, newest first, from its status events. A bundle with
 * no pack or import event (old data) still starts with "Packed" at its
 * creation time, so the history never begins mid-story.
 */
export function buildTimeline(
  events: readonly StatusEvent[],
  bundle: { createdAt: string | number | Date },
): TimelineEntry[] {
  const entries = events.map((e, i) => ({
    order: i,
    entry: {
      id: e.id,
      kind: kindOf(e),
      status: e.toStatus,
      at: new Date(e.at),
      note: isSystemReason(e.reason) ? null : e.reason,
      dispatchId: e.dispatchId,
      actorName: e.actorName ?? null,
    } satisfies TimelineEntry,
  }));
  if (!entries.some(({ entry }) => entry.kind === "packed" || entry.kind === "imported")) {
    entries.push({
      order: entries.length,
      entry: { id: "packed", kind: "packed", status: "available", at: new Date(bundle.createdAt), note: null, dispatchId: null, actorName: null },
    });
  }
  // Newest first; the server's order (already newest first) breaks ties.
  return entries.sort((a, b) => b.entry.at.getTime() - a.entry.at.getTime() || a.order - b.order).map((x) => x.entry);
}
