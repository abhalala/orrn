/**
 * The key of the FIRST save of a melt (it makes the draft). Unlike `replayKey`, edited content does NOT get a
 * new id: the server answers a repeated id with the draft it already made whatever the payload says
 * (`foundryMelt.ts` save), so the one safe rule after an answer that never came is to keep the id until a
 * definite answer, and to look for the draft by that id before anything else is sent. Pure; bun tests run it.
 */

/** The id held for the first save, with the content it was first made for. */
export type FirstSave = { id: string; payload: string } | null;

export function firstSaveKey(
  held: FirstSave,
  content: unknown,
  fresh: () => string,
): { id: string; held: NonNullable<FirstSave>; sameContent: boolean } {
  const payload = JSON.stringify(content);
  const next = held ?? { id: fresh(), payload };
  return { id: next.id, held: next, sameContent: next.payload === payload };
}

/** The draft of a cast's melts that carries `key` (the melt an unsure first save made), or null when none does. */
export function draftWithKey(
  melts: readonly { id: string; clientRequestId: string | null; serverSeq: number }[] | undefined,
  key: string,
): { id: string; serverSeq: number } | null {
  if (!key) return null;
  const m = melts?.find((x) => x.clientRequestId === key);
  return m ? { id: m.id, serverSeq: m.serverSeq } : null;
}
