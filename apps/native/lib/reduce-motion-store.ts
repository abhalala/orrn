/**
 * The system Reduce Motion setting as a small external store that follows
 * changes. Reanimated's `useReducedMotion()` returns the value from app start
 * and never updates, so someone who turned Reduce Motion on mid-session kept
 * the press scale until a restart. Pure (takes AccessibilityInfo) so bun tests
 * can drive it; lib/reduced-motion.ts wires React Native's.
 */
type AccessibilityInfoLike = {
  isReduceMotionEnabled(): Promise<boolean>;
  addEventListener(type: "reduceMotionChanged", listener: (enabled: boolean) => void): { remove(): void };
};

export function createReduceMotionStore(info: AccessibilityInfoLike, initial = false) {
  let value = initial;
  const listeners = new Set<() => void>();
  let subscription: { remove(): void } | null = null;

  const set = (next: boolean) => {
    if (next === value) return;
    value = next;
    for (const listener of listeners) listener();
  };

  return {
    get: (): boolean => value,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (!subscription) {
        subscription = info.addEventListener("reduceMotionChanged", set);
        void info.isReduceMotionEnabled().then(set, () => {});
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && subscription) {
          subscription.remove();
          subscription = null;
        }
      };
    },
  };
}
