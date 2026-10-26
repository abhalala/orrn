import { isConnectionError } from "@/features/pack/print-labels";

/**
 * BACKLOG 50: floor writes carry a `clientRequestId`. One key per attempt, reused when the same
 * call is sent again, so a reply lost on yard Wi-Fi never adds, moves or packs twice: the server
 * answers the repeat with the first result (`replayed: true`).
 */
export function newRequestKey(): string {
  return crypto.randomUUID();
}

/** orrn never answered: the request may or may not have landed. */
export function noReply(error: unknown): boolean {
  if (isConnectionError(error)) return true;
  const data = error && typeof error === "object" ? (error as { data?: { httpStatus?: number } | null }).data : undefined;
  return !data || (typeof data.httpStatus === "number" && data.httpStatus >= 502);
}

/**
 * Sends `call` with a fresh key and, when no reply came back, once more with the SAME key: a repeat
 * the server already applied comes back as the first result, never as a second write.
 */
export async function sendOnce<T>(call: (clientRequestId: string) => Promise<T>, key: string = newRequestKey()): Promise<T> {
  try {
    return await call(key);
  } catch (error) {
    if (!noReply(error)) throw error;
    return call(key);
  }
}

/**
 * A form that can be sent again (Save tapped twice, a retry after an unsure answer) keeps the SAME
 * key while its content is unchanged; edited content is a different write and gets a fresh key.
 * Clear the ref once a write has landed so the next one always has its own key.
 */
export function requestIdFor(
  previous: { id: string; body: string } | null,
  body: unknown,
  makeId: () => string = newRequestKey,
): { id: string; body: string } {
  const json = JSON.stringify(body);
  return previous && previous.body === json ? previous : { id: makeId(), body: json };
}
