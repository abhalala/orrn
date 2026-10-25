/**
 * BACKLOG 50: floor writes carry a `clientRequestId`. One key per attempt, reused when the same content is
 * sent again, so a reply lost on yard Wi-Fi never packs, adds or moves twice: the server answers the repeat
 * with the first result (`replayed: true`) and the same key with other content is a CONFLICT. Pure (the id
 * generator is passed in), so bun tests run it.
 */

/** The request id of a write being sent, with the content it was made for. */
export type ReplayAttempt = { payload: string; id: string } | null;

/**
 * Which `clientRequestId` this send uses. The same content sent again after an unsure answer (a timeout, a
 * dropped connection) reuses the id; edited content is a different write and gets a new one. A write that
 * was saved ends the attempt (`null`), so the next one always gets its own id. `fresh` makes a new id and is
 * only called when there is no attempt to reuse.
 */
export function replayKey(attempt: ReplayAttempt, content: unknown, fresh: () => string): { id: string; attempt: NonNullable<ReplayAttempt> } {
  const payload = JSON.stringify(content);
  const id = attempt && attempt.payload === payload ? attempt.id : fresh();
  return { id, attempt: { payload, id } };
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
