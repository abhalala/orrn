import { errorCodeOf } from "./pump";

/**
 * Words for a failed load or write (never `error.message`: the server's sentences are English and not for the
 * screen). `kind` is what the person was doing. Keys are `ingest.error.*`.
 */
export type ErrorKind = "load" | "action";

export type ErrorWords = { key: string; retry: boolean };

export function ingestErrorWords(error: unknown, kind: ErrorKind): ErrorWords {
  const code = errorCodeOf(error);
  switch (code) {
    case "CONFLICT":
      // The candidate moved under the person: the screen has refreshed, they look and try again.
      return { key: "ingest.error.conflict", retry: false };
    case "FORBIDDEN":
    case "UNAUTHORIZED":
      return { key: "ingest.error.forbidden", retry: false };
    case "NOT_FOUND":
      return { key: "ingest.error.notFound", retry: false };
    case "TOO_MANY_REQUESTS":
      return { key: "ingest.error.busy", retry: true };
    case "NETWORK":
    case "TIMEOUT":
      return { key: "ingest.error.network", retry: true };
    default:
      return { key: kind === "load" ? "ingest.error.load" : "ingest.error.action", retry: true };
  }
}
