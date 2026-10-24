import { Easing, FadeInDown, ZoomIn } from "react-native-reanimated";

import type { EnterSpec } from "./motion";

/** A Reanimated layout animation for an `EnterSpec`, or undefined (no animation). */
export function toEntering(spec: EnterSpec | undefined) {
  if (!spec) return undefined;
  if (spec.kind === "pop") return ZoomIn.duration(spec.duration).easing(Easing.out(Easing.back(1.6)));
  return FadeInDown.delay(spec.delay).duration(spec.duration).easing(Easing.out(Easing.cubic));
}
