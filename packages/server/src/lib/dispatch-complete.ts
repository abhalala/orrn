export type CompleteFrom = "draft" | "reserved";

export const COMPLETE_ID_CHUNK_SIZE = 50;
export const COMPLETE_EVENT_CHUNK_SIZE = 10;
export const BUNDLE_LOCK_ERROR = "Bundle not available";
export const BUNDLE_LOCK_CONSTRAINT = "NOT NULL constraint failed: dispatch.status";

export function completeEventFromStatus(from: CompleteFrom) {
  return from === "draft" ? "available" as const : "reserved" as const;
}

export function isBundleLockAbort(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(BUNDLE_LOCK_ERROR) || message.includes(BUNDLE_LOCK_CONSTRAINT);
}
