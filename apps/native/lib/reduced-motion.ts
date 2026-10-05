import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion as reducedMotionAtStart } from "react-native-reanimated";

import { createReduceMotionStore } from "./reduce-motion-store";

// Reanimated's value is a constant read at app start (not a real hook), so it is
// a correct first value; the store then follows the system setting live.
const store = createReduceMotionStore(AccessibilityInfo, reducedMotionAtStart());

/** Whether the system asks for reduced motion, updated when the setting changes. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(store.subscribe, store.get);
}
