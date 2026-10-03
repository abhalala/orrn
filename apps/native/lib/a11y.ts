import { AccessibilityInfo, Platform } from "react-native";

/**
 * Speak a status message (save result, sign-in error) to VoiceOver/TalkBack
 * without moving focus. Android also reads `accessibilityLiveRegion`, so on
 * Android this only covers text that isn't already in a live region.
 */
export function announce(message: string): void {
  if (!message) return;
  if (Platform.OS === "ios") {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  } else {
    AccessibilityInfo.announceForAccessibility(message);
  }
}
