import type { DispatchStatus } from "@orrn/domain";

export type DispatchNowApi = { reserve: () => Promise<unknown>; complete: () => Promise<unknown> };

/**
 * The one Dispatch button (ruling T22). From Building it holds the stock
 * first, then completes; from Held it only completes. `state.held` remembers
 * that the hold went through, so a retry after a failed complete does not
 * hold twice. Any other status refuses.
 */
export async function dispatchNow(status: DispatchStatus, state: { held: boolean }, api: DispatchNowApi): Promise<void> {
  if (status !== "draft" && status !== "reserved") {
    throw new Error(`Cannot dispatch a ${status} dispatch`);
  }
  if (status === "draft" && !state.held) {
    await api.reserve();
    state.held = true;
  }
  await api.complete();
}
