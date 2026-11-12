import type { EngineHints } from "./reader-engine";
import type { ReadBlock } from "./reader-protocol";

/**
 * Putting the tables of a file again (server round 7): before any row of the file is written, the whole block list may be
 * sent again, a block with a new hint, and the count may change. This file plans it: which header rows the file is read
 * under this time. The reading and sending is `uploadOneFile` with a `reput` hook.
 *
 * - "Start a new table here" on a title row: the table is read to the row above it, and the rest of the sheet is read as
 *   further tables, each through the header step.
 * - "It continues the table above": the table above is read to the last row of this one, with this table's title lines
 *   skipped, and this table is no more.
 */

export type StoredBlock = {
  ordinal: number;
  sheetName: string | null;
  headerRow: number;
  headerRows: number;
  /** The saved pick's end and skipped rows, and the table above it (server round 8: BlockView carries them). */
  lastDataRow?: number | null;
  skipRows?: number[];
  follows?: { ordinal: number; gapRows: number; continues: boolean } | null;
};

/** `row` is the sheet row of the title, counted from 0. */
export type ReputAction = { kind: "continues"; ordinal: number } | { kind: "newTable"; ordinal: number; row: number };

export type ReputPlan = { hints: { sheet: string | null; hint: EngineHints }[] };

const sheetOf = (name: string | null) => name ?? "";

/** The hint a saved table was picked under, as it was saved. */
const savedHint = (s: StoredBlock): EngineHints => ({
  headerRow: s.headerRow,
  headerRows: s.headerRows === 2 ? 2 : 1,
  ...((s.lastDataRow ?? null) !== null ? { lastDataRow: s.lastDataRow } : {}),
  ...((s.skipRows ?? []).length > 0 ? { skipRows: s.skipRows } : {}),
});

/** The block of the new read that is the stored block: the same place among the blocks of its sheet. */
function matching(guess: readonly ReadBlock[], stored: readonly StoredBlock[], s: StoredBlock): ReadBlock | undefined {
  const sameSheet = stored.filter((x) => sheetOf(x.sheetName) === sheetOf(s.sheetName)).sort((a, b) => a.ordinal - b.ordinal);
  const index = sameSheet.findIndex((x) => x.ordinal === s.ordinal);
  const guessed = guess.filter((g) => sheetOf(g.meta?.sheetName ?? g.input.sheetName) === sheetOf(s.sheetName)).sort((a, b) => a.input.ordinal - b.input.ordinal);
  return guessed[index];
}

/**
 * The hints to read the file under: every stored table whose header row differs from what the reader guesses keeps its stored
 * header (so a person's earlier pick is not lost), then the action's hint. `null` when the action cannot be planned (the file
 * reads differently from the one stored).
 */
export function planReput(guess: readonly ReadBlock[], stored: readonly StoredBlock[], action: ReputAction): ReputPlan | null {
  const target = stored.find((s) => s.ordinal === action.ordinal);
  const here = target && matching(guess, stored, target);
  if (!target || !here?.meta) return null;
  const hints = new Map<string, { sheet: string | null; hint: EngineHints }>();
  const key = (sheet: string | null, headerRow: number) => `${sheetOf(sheet)}\u0000${headerRow}`;
  for (const s of stored) {
    const g = matching(guess, stored, s);
    if (!g?.meta) continue;
    // A table saved under a person's pick keeps it whole: the header, where the table ends and the rows it skips.
    const picked = (s.lastDataRow ?? null) !== null || (s.skipRows ?? []).length > 0;
    if (picked || g.meta.guess.headerRow !== s.headerRow || (g.meta.guess.headerRows ?? 1) !== s.headerRows) {
      hints.set(key(s.sheetName, s.headerRow), { sheet: s.sheetName, hint: savedHint(s) });
    }
  }
  if (action.kind === "newTable") {
    const lastDataRow = action.row - here.meta.rowBase - 1;
    if (lastDataRow < here.meta.firstDataRow) return null;
    hints.set(key(target.sheetName, target.headerRow), { sheet: target.sheetName, hint: { ...savedHint(target), lastDataRow } });
  } else {
    // The table above is the one the server says this one follows; else the one just before it on the sheet.
    const above =
      (target.follows ? stored.find((s) => s.ordinal === target.follows!.ordinal) : undefined) ??
      stored
        .filter((s) => sheetOf(s.sheetName) === sheetOf(target.sheetName) && s.ordinal < target.ordinal)
        .sort((a, b) => b.ordinal - a.ordinal)[0];
    if (!above) return null;
    hints.delete(key(target.sheetName, target.headerRow));
    hints.set(key(above.sheetName, above.headerRow), {
      sheet: above.sheetName,
      hint: {
        ...savedHint(above),
        lastDataRow: here.meta.lastDataRow,
        // What the table above already skipped stays skipped, and this table's title lines are skipped too.
        ...((above.skipRows ?? []).length + here.meta.titleRows.length > 0 ? { skipRows: [...new Set([...(above.skipRows ?? []), ...here.meta.titleRows])].sort((a, b) => a - b) } : {}),
      },
    });
  }
  return { hints: [...hints.values()] };
}

/** Files kept in memory by artifact, so a screen other than the upload screen can read the same file again. Gone with the page. */
const memory = new Map<string, File>();
export const rememberFile = (artifactId: string, file: File) => void memory.set(artifactId, file);
export const rememberedFile = (artifactId: string): File | undefined => memory.get(artifactId);
export const forgetFile = (artifactId: string) => void memory.delete(artifactId);
