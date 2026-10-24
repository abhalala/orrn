import * as Haptics from "expo-haptics";

/**
 * Success and error haptics (C2: the only two). A buzz is never the only
 * signal: every caller also shows text and announces it (lib/a11y.ts). Haptics
 * fail quietly on devices without a taptic engine.
 */
const quiet = () => undefined;

export const feedback = {
  success(): void {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(quiet);
  },
  error(): void {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(quiet);
  },
};
