/**
 * When a status message must be spoken with `announce()`. Pure (no React
 * Native imports) so bun tests can load it.
 *
 * TalkBack reads `accessibilityLiveRegion` on its own, so announcing text that
 * is already shown in a live region makes Android say it twice. VoiceOver
 * ignores that prop, so iOS always needs the announcement.
 */
export function needsAnnounce(os: string, { shownInLiveRegion = false }: { shownInLiveRegion?: boolean } = {}): boolean {
  return !(os === "android" && shownInLiveRegion);
}
