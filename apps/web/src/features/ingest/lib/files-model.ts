import type { ListFormat } from "./list-model";
import type { ArtifactSummary } from "./types";
import { isVisualKind } from "./vision-render";

/**
 * Files that are not a candidate: the ones kept and not read (PDFs and photos, owner decision 2026-11-11), and the ones
 * whose upload was left half way (the page closed during the header step or the sending of rows).
 */

/** The read state the server gives a PDF or photo it keeps without reading. It is not in the shared list of read states yet. */
export const KEPT_UNREAD = "kept_unread";

export type KeptFile = { id: string; name: string; size: string; date: string; reading: boolean };

/** `1.5 KB`, `2.4 MB`: a size as a person reads it, with the plant's grouping. */
export function sizeText(bytes: number, count: (n: number) => string = String): string {
  if (bytes < 1024) return `${count(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${count(Math.round(kb * 10) / 10)} KB`;
  return `${count(Math.round((kb / 1024) * 10) / 10)} MB`;
}

/**
 * Files kept and not read, newest first, each with its size and date as the list shows them. A PDF or photo being read
 * page by page is listed too (`reading`): its file page carries on, adding the file again is not needed.
 */
export function keptFiles(artifacts: readonly ArtifactSummary[], fmt: ListFormat): KeptFile[] {
  return artifacts
    .filter((a) => String(a.readState) === KEPT_UNREAD || (a.readState === "reading" && isVisualKind(a.kind)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((a) => ({ id: a.id, name: a.fileName, size: sizeText(a.sizeBytes, fmt.count), date: fmt.date(a.createdAt), reading: a.readState === "reading" }));
}

/**
 * Files still marked as being read that this page is not sending: the person closed the page before the file was
 * finished. Add the file again and it carries on from where it stopped. The newest three show, so abandoned files never fill the page.
 */
export const UNFINISHED_SHOWN = 3;

export function unfinishedFiles(artifacts: readonly ArtifactSummary[], sending: ReadonlySet<string>): { id: string; name: string }[] {
  return artifacts
    // A PDF or photo being read page by page carries on from its file page, not by adding it again.
    .filter((a) => a.readState === "reading" && !isVisualKind(a.kind) && !sending.has(a.id))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, UNFINISHED_SHOWN)
    .map((a) => ({ id: a.id, name: a.fileName }));
}
