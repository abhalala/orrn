import { Redirect } from "expo-router";

import { useGateRoute } from "@/lib/gate-context";

/**
 * "/" (a cold start, an unknown link, "Go to Today") and the root Stack's
 * fallback whenever a gate flips and the current screen disappears: send the
 * person to where the gate says they belong.
 */
export default function Index() {
  return <Redirect href={useGateRoute()} />;
}
