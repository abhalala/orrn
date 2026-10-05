/**
 * React Query's focus source on native. The web refetches stale queries when
 * the window regains focus; React Native has no window, so without this a
 * phone woken from a pocket kept a 30 s stale `auth.me` (an expired session or
 * a removed membership showed nothing until a query failed) and every mounted
 * tab kept old numbers. Pure (takes AppState) so bun tests can drive it.
 *
 * Use: `focusManager.setEventListener(appStateFocus(AppState))`.
 */
type AppStateLike = {
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
};

export function appStateFocus(appState: AppStateLike) {
  return (handleFocus: (focused?: boolean) => void): (() => void) => {
    const subscription = appState.addEventListener("change", (state) => handleFocus(state === "active"));
    return () => subscription.remove();
  };
}
