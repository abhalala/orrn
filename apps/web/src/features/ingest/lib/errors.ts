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
/** The server's refusal once any row of the file is written: the columns cannot change any more. */
const ALREADY_WRITTEN = /^Rows of this sheet are already written/i;
/** Server round 8: a file that is being read again cannot be approved or merged; a sheet approved cannot change its tables. */
const READ_AGAIN_APPROVE = /^This file is being read again/i;
const READ_AGAIN_MERGE = /^A file is being read again/i;
const SHEET_APPROVED = /^A sheet of this file is approved/i;
/** Server round 9: no line to skip, an answer that cannot change once a sheet is approved, a question this import does not ask. */
const NO_DATE_NONE = /^No line on this sheet is missing a date/i;
const ANSWER_LOCKED = /^A sheet of this file is approved\. Its answers cannot change/i;
const DOES_NOT_ASK = /^This import does not ask that/i;
const NOTHING_TO_IMPORT = /^Nothing in this sheet can be imported/i;

/**
 * The vision read's server sentences (contract section 8b), matched by their text before anything else: "Its rows
 * cannot change now" starts like the columns sentence above, and the PRECONDITION_FAILED ones would otherwise fall to
 * the generic refusal with English under it. Each has plain words under `ingest.vision.error.*`.
 */
export const VISION_SENTENCES: readonly (readonly [RegExp, string])[] = [
  [/^Upload this page first/i, "ingest.vision.error.uploadFirst"],
  [/^Some pages are not read yet/i, "ingest.vision.error.notSettled"],
  [/^This table was read from a page/i, "ingest.vision.error.fromPage"],
  [/^Only a table read from a page is checked against it/i, "ingest.vision.error.onlyFromPage"],
  [/^This page is past the pages read for this file/i, "ingest.vision.error.pastPages"],
  [/^This page is already read/i, "ingest.vision.error.pageRead"],
  [/^This file is not being read page by page/i, "ingest.vision.error.notPageByPage"],
  [/^Only PDFs and photos are read page by page/i, "ingest.vision.error.onlyVisual"],
  [/^Rows of this sheet are already written\. Its rows cannot change/i, "ingest.vision.error.rowsWritten"],
  [/^PDFs and photos need file storage/i, "ingest.vision.error.noStorage"],
  [/^PDFs and photos are kept, not read, in this release/i, "ingest.vision.error.notRead"],
  [/^The original file is not saved yet/i, "ingest.vision.error.notSaved"],
  [/^This file is already read/i, "ingest.vision.error.fileRead"],
  [/^Check these rows against the page first/i, "ingest.vision.error.checkFirst"],
  [/^Import file not found/i, "ingest.vision.error.fileGone"],
  [/^This file already holds \d+ tables, the most one file can hold/i, "ingest.vision.error.fileFull"],
  [/^The tables read from this page could not be written/i, "ingest.vision.error.rebuildFailed"],
  [/^Someone who can see prices must check this table/i, "ingest.vision.error.needsPrices"],
];

/**
 * The chunked upload's server sentences (limits brief part B, `upload-parts.ts` on the server), each with plain words
 * under `ingest.upload.error.*`.
 */
export const UPLOAD_SENTENCES: readonly (readonly [RegExp, string])[] = [
  [/^Some parts of the file have not arrived/i, "ingest.upload.error.partsMissing"],
  [/^The file does not match its digest/i, "ingest.upload.error.digest"],
  [/^The upload ran out/i, "ingest.upload.error.ranOut"],
  // fix round (decision 4, security M2 and L7)
  [/^This file is still being checked/i, "ingest.upload.error.checkRunning"],
  [/^Someone else is sending this file now/i, "ingest.upload.error.someoneElse"],
];

/** A server sentence after which trying again does not help: the file must be added again. */
export const UPLOAD_FINAL_SENTENCES: readonly (readonly [RegExp, string])[] = [
  [/^orrn could not check this file after it arrived/i, "ingest.upload.error.checkFailed"],
];

/**
 * The refusals of `artifact.begin` that name a file or a limit (fix round decisions 2 and 3), as a problem line with
 * its values: the old refusal by kind when there is no vault, the plant's largest file per upload and its storage
 * quota. The words say Godseye staff can raise a limit unless it is already at its ceiling. Null for any other text.
 * The upload strip's `problemFromError` (upload.ts) calls this.
 */
export function beginRefusalWords(error: unknown): { key: string; vars: Record<string, string> } | null {
  const said = messageOf(error);
  let m = /^(.+) is too big\. The limit for this kind of file is (\d+) MB\.$/.exec(said);
  if (m) return { key: "ingest.upload.refused.tooBigKind", vars: { name: m[1]!, limit: m[2]! } };
  m = /^(.+) is too big\. The largest file for this plant is (\d+ [MG]B)\. Godseye staff can raise it\.$/.exec(said);
  if (m) return { key: "ingest.upload.refused.fileTooBig", vars: { name: m[1]!, size: m[2]! } };
  m = /^(.+) is too big\. The largest file orrn can take is (\d+ [MG]B)\.$/.exec(said);
  if (m) return { key: "ingest.upload.refused.fileTooBigMax", vars: { name: m[1]!, size: m[2]! } };
  m = /^This plant's file storage is full \((\d+ GB)\)\. Godseye staff can raise it\.$/.exec(said);
  if (m) return { key: "ingest.upload.refused.storageFull", vars: { size: m[1]! } };
  m = /^This plant's file storage is full \((\d+ GB)\)\.$/.exec(said);
  if (m) return { key: "ingest.upload.refused.storageFullMax", vars: { size: m[1]! } };
  return null;
}

const messageOf = (error: unknown): string => {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message.trim().slice(0, 400) : "";
};

export function ingestErrorWords(error: unknown, kind: ErrorKind): ErrorWords {
  const code = errorCodeOf(error);
  const said = messageOf(error);
  for (const [sentence, key] of VISION_SENTENCES) if (sentence.test(said)) return { key, retry: false };
  for (const [sentence, key] of UPLOAD_SENTENCES) if (sentence.test(said)) return { key, retry: true };
  for (const [sentence, key] of UPLOAD_FINAL_SENTENCES) if (sentence.test(said)) return { key, retry: false };
  if (NO_DATE_NONE.test(messageOf(error))) return { key: "ingest.error.noDateNone", retry: false };
  if (ANSWER_LOCKED.test(messageOf(error))) return { key: "ingest.error.answerLocked", retry: false };
  if (DOES_NOT_ASK.test(messageOf(error))) return { key: "ingest.error.doesNotAsk", retry: false };
  if (READ_AGAIN_APPROVE.test(messageOf(error))) return { key: "ingest.error.beingReadAgainApprove", retry: false };
  if (READ_AGAIN_MERGE.test(messageOf(error))) return { key: "ingest.error.beingReadAgainMerge", retry: false };
  if (SHEET_APPROVED.test(messageOf(error))) return { key: "ingest.error.sheetApproved", retry: false };
  if (code === "BAD_REQUEST" && ALREADY_WRITTEN.test(messageOf(error))) return { key: "ingest.error.alreadyWritten", retry: false };
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
