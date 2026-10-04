import { AccessibilityInfo, Platform } from "react-native";

import { needsAnnounce } from "./a11y-policy";

/**
 * Speak a status message (save result, sign-in error) to VoiceOver/TalkBack
 * without moving focus. Pass `shownInLiveRegion` when the same text is also
 * rendered with `accessibilityLiveRegion`: Android reads that by itself, so
 * it is announced only on iOS (lib/a11y-policy.ts).
 */
export function announce(message: string, options?: { shownInLiveRegion?: boolean }): void {
  if (!message || !needsAnnounce(Platform.OS, options)) return;
  if (Platform.OS === "ios") {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  } else {
    AccessibilityInfo.announceForAccessibility(message);
  }
}
