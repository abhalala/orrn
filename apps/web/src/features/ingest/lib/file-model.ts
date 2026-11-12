import { fileYearTargets, yearLine, type YearLine } from "./year-model";
import { fitWords, rowAction, rowTitle, statusChip, type ListRow } from "./list-model";
import type { Words } from "./model";
import type { ArtifactDetail, CandidateDetail } from "./types";

/**
 * The file screen's model (work order 3.5, S17). Each table of the file is a row of the same list as the
 * candidates page, with the columns of its block as a second line. The year line is asked once for the whole file,
 * and only when the file has orders or bundles.
 */

export type FileRow = { row: ListRow; columns: string[] };

/** Every import of the file in block order, as list rows, with the headers of its table. A discarded one stays (this is the file's own page). */
export function fileRows(
  blocks: ArtifactDetail["blocks"],
  can: { merge: boolean; upload: boolean },
): FileRow[] {
  return blocks.flatMap((block) =>
    block.candidates.map((candidate): FileRow => ({
      columns: block.headers,
      row: {
        id: candidate.id,
        candidate,
        title: rowTitle(candidate),
        fit: fitWords(candidate),
        chip: statusChip(candidate),
        numbers: { create: candidate.counts.create, update: candidate.counts.update, questions: candidate.openQuestions, cannot: candidate.counts.refused },
        action: rowAction(candidate, can),
        reasonCode: candidate.reasonCode,
        reasonDetail: candidate.reasonDetail,
      },
    })),
  );
}

/** "3 rows, 1 table, added on 11 Nov 2026". The server sends only a user id for who added it, so no name yet. */
export function fileSubtitle(file: Pick<ArtifactDetail, "rowCount" | "blockCount" | "createdAt">, date: (ms: number) => string): Words {
  return { key: "ingest.file.subtitleNoName", vars: { rows: file.rowCount, tables: file.blockCount, date: date(file.createdAt) } };
}

/** The vault line: one muted sentence for each state. */
export function vaultWords(state: ArtifactDetail["vaultState"]): Words {
  return { key: state === "stored" ? "ingest.vault.stored" : state === "not_stored" ? "ingest.vault.notStored" : "ingest.vault.pending" };
}

/**
 * The year line of the file: null unless the file has orders or bundles. The year is the file's (`period.confirm`
 * takes the artifact), so it reads from the file's own guess and saved year, with the target of the first dated table.
 */
export function fileYear(
  file: Pick<ArtifactDetail, "period" | "periodConfirmed" | "blocks">,
  day: (iso: string) => string,
  now?: Date,
): YearLine {
  if (!fileYearTargets(file.blocks)) return { show: false };
  const dated = file.blocks.flatMap((b) => b.candidates).find((c) => c.target === "orders" || c.target === "bundles");
  const source: Pick<CandidateDetail, "target" | "questions" | "period" | "periodConfirmed"> = {
    target: dated?.target ?? null,
    questions: [],
    period: file.period,
    periodConfirmed: file.periodConfirmed,
  };
  return yearLine(source, day, now);
}

/**
 * The file's one answer to "Some lines have no date. orrn took each one's date from the dated line just above it. Is that
 * right?" (server round 10: it is stored once, on the file, and every order sheet shows it). Null before it is answered.
 */
export function fillAnswerWords(file: { fillAbove?: { answer: boolean } | null }): Words | null {
  if (!file.fillAbove) return null;
  return { key: "ingest.file.fillAbove", varKeys: { answer: file.fillAbove.answer ? "common.yes" : "common.no" } };
}
