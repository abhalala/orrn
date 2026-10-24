/**
 * "Recent" dies for the die picker, from the newest packing sessions rather
 * than the newest page of `die.list` (which is ordered by when the die was
 * created and capped at 100, so it loses the dies actually in use: T20-quality
 * gotcha).
 */
export function recentDieIds(sessions: readonly { dieId: string }[], limit: number): string[] {
  const out: string[] = [];
  for (const s of sessions) {
    if (out.length >= limit) break;
    if (!out.includes(s.dieId)) out.push(s.dieId);
  }
  return out;
}
