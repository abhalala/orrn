import type { DispatchStatus } from "@orrn/domain";

export type DispatchNowApi = {
  reserve(): Promise<unknown>;
  complete(): Promise<unknown>;
};

/**
 * The confirm sheet's one press of Dispatch. From Building the server only
 * completes a held dispatch, so the stock is held first, then dispatched
 * (ruling T22). `state.held` remembers a hold made by this sheet: a retry
 * after a failed complete must not hold again while the screen, not yet
 * refreshed, still says Building.
 */
export async function dispatchNow(status: DispatchStatus, state: { held: boolean }, api: DispatchNowApi): Promise<void> {
  if (status !== "draft" && status !== "reserved") {
    throw new Error(`A ${status} dispatch can't be dispatched`);
  }
  if (status === "draft" && !state.held) {
    await api.reserve();
    state.held = true;
  }
  await api.complete();
}
