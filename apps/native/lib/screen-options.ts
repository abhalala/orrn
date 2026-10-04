import { Platform } from "react-native";

import { stackOptions } from "./stack-options";
import { useThemeColor } from "./theme";

/**
 * Themed options for every Stack: canvas background, ink text, Bricolage
 * titles, no header hairline (lib/stack-options.ts). `largeTitle` gives tab
 * roots the iOS large title (screens must scroll with
 * `contentInsetAdjustmentBehavior="automatic"`).
 */
export function useStackOptions({ largeTitle = false }: { largeTitle?: boolean } = {}) {
  const canvas = useThemeColor("background");
  const ink = useThemeColor("foreground");
  return stackOptions({ os: Platform.OS, canvas, ink, largeTitle });
}
