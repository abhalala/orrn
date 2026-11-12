import { errorCodeOf } from "./pump";

/**
 * Words for a failed load or write (never `error.message`: the server's sentences are English and not for the
 * screen). `kind` is what the person was doing. Keys are `ingest.error.*`.
 */
export type ErrorKind = "load" | "action";

export type ErrorWords = {
  key: string;
  retry: boolean;
  /**
   * The server's own sentence, for the few refusals that name a file, a sheet or a section ("... adds section R 2105.
   * Finish it first, then check this sheet again."). It is English, so the screen draws it with `lang="en"` under the
   * words of `key`. Only a PRECONDITION_FAILED refusal carries one: those are written for a person.
   */
  detail?: string;
  /** The refusal ends in "check this sheet again": the screen offers that button next to it. */
  checkAgain?: boolean;
};

const CHECK_AGAIN = /check this sheet again/i;
/** Rule 7.4: "Nothing in this sheet can be imported. Fix the rows or discard it." has words of its own, without the English. */
const NOTHING_TO_IMPORT = /^Nothing in this sheet can be imported/i;

const messageOf = (error: unknown): string => {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message.trim().slice(0, 400) : "";
};

export function ingestErrorWords(error: unknown, kind: ErrorKind): ErrorWords {
  const code = errorCodeOf(error);
  if (code === "PRECONDITION_FAILED") {
    const detail = messageOf(error);
    if (NOTHING_TO_IMPORT.test(detail)) return { key: "ingest.error.nothingToImport", retry: false };
    if (detail !== "") {
      const checkAgain = CHECK_AGAIN.test(detail);
      return { key: checkAgain ? "ingest.error.checkAgain" : "ingest.error.refused", retry: false, detail, checkAgain };
    }
  }
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
