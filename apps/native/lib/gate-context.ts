import { createContext, useContext } from "react";

import type { GateRoute } from "./gate";

/** The gate's current decision, for `app/index.tsx` to redirect to. */
export const GateContext = createContext<GateRoute>("/(auth)/sign-in");

export function useGateRoute(): GateRoute {
  return useContext(GateContext);
}
