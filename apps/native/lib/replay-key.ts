/**
 * BACKLOG 50: floor writes carry a `clientRequestId`. One key per attempt, reused when the same content is
 * sent again, so a reply lost on yard Wi-Fi never packs, adds or moves twice: the server answers the repeat
 * with the first result (`replayed: true`) and the same key with other content is a CONFLICT. Pure (the id
 * generator is passed in), so bun tests run it.
 */

/** The request id of a write being sent, with the content it was made for. */
export type ReplayAttempt = { payload: string; id: string; earlier?: Readonly<Record<string, string>> } | null;

/** How many unsaved earlier sends are remembered; a person edits a handful of times, not dozens. */
const REMEMBERED = 8;

/**
 * Which `clientRequestId` this send uses. The same content sent again after an unsure answer (a timeout, a
 * dropped connection) reuses the id; edited content is a different write and gets a new one. A write that
 * was saved ends the attempt (`null`), so the next one always gets its own id. `fresh` makes a new id and is
 * only called when there is no attempt to reuse.
 *
 * Earlier unsaved sends are remembered too: an unsure send may have landed, so editing and then reverting
 * to the first content must send the FIRST id again (the server answers with the first result) rather than
 * a new one that would save the same thing twice.
 */
export function replayKey(attempt: ReplayAttempt, content: unknown, fresh: () => string): { id: string; attempt: NonNullable<ReplayAttempt> } {
  const payload = JSON.stringify(content);
  const earlier: Record<string, string> = { ...(attempt?.earlier ?? {}) };
  if (attempt) earlier[attempt.payload] = attempt.id;
  const id = earlier[payload] ?? fresh();
  delete earlier[payload];
  const kept = Object.entries(earlier).slice(-REMEMBERED);
  return { id, attempt: { payload, id, ...(kept.length > 0 ? { earlier: Object.fromEntries(kept) } : {}) } };
}

/** orrn never answered: the request may or may not have landed (no tRPC code, or a gateway 502 or later). */
export function noReply(error: unknown): boolean {
  const data = error && typeof error === "object" ? (error as { data?: { httpStatus?: number } | null }).data : undefined;
  return !data || (typeof data.httpStatus === "number" && data.httpStatus >= 502);
}

/**
 * Sends `call` with `key` and, when no reply came back, once more with the SAME key: a repeat the server
 * already applied comes back as the first result, never as a second write.
 */
export async function sendOnce<T>(call: (clientRequestId: string) => Promise<T>, key: string): Promise<T> {
  try {
    return await call(key);
  } catch (error) {
    if (!noReply(error)) throw error;
    return call(key);
  }
}
