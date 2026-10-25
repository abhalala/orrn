import { createContext, useContext } from "react";

import type { ReleaseDecision } from "./release-gate";

/** The gate's last decision while the app is open, for More ("could not check, opens until ..."). */
export const ReleaseStatusContext = createContext<ReleaseDecision | null>(null);

export function useReleaseStatus(): ReleaseDecision | null {
  return useContext(ReleaseStatusContext);
}
