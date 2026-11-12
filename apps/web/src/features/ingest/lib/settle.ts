import type { IngestApi } from "./api";
import { headerAskView, hintOfPick, isCurrentHeader, type HeaderAskView, type HeaderQuestion, type HeaderReply } from "./header-step";
import { ReadError } from "./reader-client";
import type { EngineHints } from "./reader-engine";
import type { ReadBlock, SheetHints, WireBlockInput } from "./reader-protocol";
import type { CandidateSummary, HeaderAnswer } from "./types";

/**
 * Settling the header of every table of a file before any row is sent (rule 4.1, owner decision 2026-11-11).
 *
 * Every call to `putBlocks` carries every block with its preview and the header the reader guessed, no rows. The server
 * answers per block: `keep` (the header fits a layout the plant knows; the block is saved), `reread` (another row fits:
 * read the table again with that row and send it again) or `ask` (nothing fits: the person says which row has the column
 * names, the table is read again with that row as a hint, and sent again as the person's pick). A table the person does not
 * want is sent as an empty table under their pick and its import is discarded after the file is complete, so the number of
 * blocks of the file never changes after the first call, which is the server's rule.
 */

export type Settled = {
  /** Every block of the file, as it will be sent. A skipped table has no rows. */
  blocks: ReadBlock[];
  ids: Map<number, string>;
  /** Blocks of tables the person chose not to import: their candidates are discarded once the file is complete. */
  skipped: Set<number>;
  candidates: CandidateSummary[];
};

export type SettleDeps = {
  api: Pick<IngestApi, "artifactPutBlocks">;
  artifactId: string;
  blocks: ReadBlock[];
  /** Reads the file again with these hints. A hint that cannot be followed rejects with a `ReadError` of code `hint_error`. */
  reread: (hints: SheetHints[]) => Promise<ReadBlock[]>;
  /** Shows the step for one table and waits for the person. */
  ask: (view: HeaderAskView) => Promise<HeaderReply>;
  /** Every table is answered: the step goes away. */
  asked?: () => void;
};

/** A round that does not settle anything again and again is a bug, not a slow person. */
const MAX_ROUNDS = 40;

const sheetOf = (b: ReadBlock) => b.meta?.sheetName ?? b.input.sheetName ?? null;
const hintKey = (sheet: string | null, headerRow: number) => `${sheet ?? ""}\u0000${headerRow}`;
/** The blocks of one table (the parts of a long one) share this key. */
const tableKey = (b: ReadBlock) => `${sheetOf(b) ?? ""}\u0000${b.meta?.tableIndex ?? b.input.ordinal}`;

const isHintError = (error: unknown) => error instanceof ReadError && error.failure.code === "hint_error";

type Held = { sheet: string | null; hint: EngineHints; send: boolean };

export async function settleHeaders(deps: SettleDeps): Promise<Settled> {
  const { api, artifactId } = deps;
  let blocks = deps.blocks;
  const ids = new Map<number, string>();
  const skipped = new Set<number>();
  let held = new Map<string, Held>();
  let candidates: CandidateSummary[] = [];
  /** Tables joined to the one above: a read gives one table fewer, so each stays as an empty block at its place. */
  const joined = new Map<number, ReadBlock>();

  const sheetHints = (): SheetHints[] => {
    const bySheet = new Map<string, SheetHints>();
    for (const h of held.values()) {
      const entry = bySheet.get(h.sheet ?? "") ?? { sheetName: h.sheet, hints: [] };
      entry.hints.push(h.hint);
      bySheet.set(h.sheet ?? "", entry);
    }
    return [...bySheet.values()].map((e) => ({ ...e, hints: e.hints.sort((a, b) => a.headerRow - b.headerRow) }));
  };

  const wire = (b: ReadBlock): WireBlockInput => {
    const input: WireBlockInput = { ...b.input };
    if (skipped.has(b.input.ordinal)) {
      // The person does not want this table: an empty table under their own pick.
      input.rowCount = 0;
      input.sample = [];
      delete input.merged;
      input.hint = { headerRow: input.headerRow, headerRows: input.headerRows === 2 ? 2 : 1 };
      return input;
    }
    const h = b.meta && held.get(hintKey(sheetOf(b), b.meta.guess.headerRow));
    if (h?.send && b.meta?.hints) input.hint = { headerRow: input.headerRow, headerRows: input.headerRows === 2 ? 2 : 1 };
    return input;
  };

  /** The file again under the hints held now. The count of blocks may not change; a skipped table stays empty. */
  const readAgain = async (): Promise<boolean> => {
    let next: ReadBlock[];
    try {
      next = await deps.reread(sheetHints());
    } catch (error) {
      if (isHintError(error)) return false;
      throw error;
    }
    if (next.length !== blocks.length - joined.size) return false;
    let at = 0;
    blocks = blocks.map((b, i) => {
      const placeholder = joined.get(b.input.ordinal);
      if (placeholder) return placeholder;
      const fresh = next[at++]!;
      return { ...fresh, input: { ...fresh.input, ordinal: i } };
    });
    return true;
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const sent = blocks.map(wire);
    // A skipped table is sent without rows; the blocks the rows go out of are the ones still in `blocks`.
    const res = await api.artifactPutBlocks({ artifactId, blocks: sent });
    candidates = res.candidates;
    for (const b of res.blocks) ids.set(b.ordinal, b.blockId);
    // A server that answers without `header` (the old shape) has settled every block it kept.
    const header: HeaderAnswer[] = res.header ?? res.blocks.map((b) => ({ ordinal: b.ordinal, answer: "keep" as const, by: "reader" as const, blockId: b.blockId }));
    const open = header.filter((h): h is Exclude<HeaderAnswer, { answer: "keep" }> => h.answer !== "keep");
    if (open.length === 0) {
      return { blocks: blocks.map((b) => (skipped.has(b.input.ordinal) ? { ...b, rows: [], input: { ...b.input, rowCount: 0, sample: [] } } : b)), ids, skipped, candidates };
    }

    // 1. Tables another row of which fits a layout the plant knows: read again with that row, no question.
    const rereads = open.filter((h): h is Extract<HeaderAnswer, { answer: "reread" }> => h.answer === "reread");
    const unread = new Set<number>();
    if (rereads.length > 0) {
      const before = new Map(held);
      for (const r of rereads) {
        const b = blocks[r.ordinal]!;
        held.set(hintKey(sheetOf(b), r.headerRow), { sheet: sheetOf(b), hint: { headerRow: r.headerRow, headerRows: r.headerRows }, send: false });
      }
      if (await readAgain()) continue;
      // The row the server names cannot be followed in this file: the person is asked instead.
      held = before;
      for (const r of rereads) unread.add(r.ordinal);
    }

    // 2. Tables nothing fits: the person says which row. One question for each table, parts of a long one together.
    const asks = new Map<string, HeaderQuestion>();
    for (const h of open) {
      const b = blocks[h.ordinal]!;
      const key = tableKey(b);
      const found = asks.get(key);
      if (found) {
        found.blocks.push(b);
        continue;
      }
      if (h.answer === "ask") asks.set(key, { key, blocks: [b], guess: h.guess, candidates: h.candidates, resembles: h.resembles });
      else if (unread.has(h.ordinal)) {
        const g = b.meta?.guess;
        asks.set(key, { key, blocks: [b], guess: { headerRow: g?.headerRow ?? b.input.headerRow, headerRows: g?.headerRows === 2 ? 2 : 1 }, candidates: [], resembles: null });
      }
    }
    const questions = [...asks.values()];
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]!;
      let hintError = false;
      let attempt = 0;
      for (;;) {
        attempt += 1;
        // Parts of a table are read again together, so look the table up again after a read.
        const current = blocks.filter((b) => tableKey(b) === q.key);
        q.blocks = current.length > 0 ? current : q.blocks;
        const first = q.blocks[0]!;
        const upper = upperOf(blocks, first);
        const view = headerAskView(q, { position: i + 1, total: questions.length }, { upper: upper && !ids.has(upper.input.ordinal) ? upper : undefined, hintError, attempt });
        const reply = await deps.ask(view);
        if (reply.kind === "skip") {
          for (const b of q.blocks) skipped.add(b.input.ordinal);
          break;
        }
        const before = new Map(held);
        const sheet = sheetOf(first);
        if (reply.kind === "pick") {
          const pick = { headerRow: reply.headerRow, headerRows: reply.headerRows };
          // The table was read under this header already: nothing to read again, the pick is the person's.
          held.delete(hintKey(sheet, first.meta?.guess.headerRow ?? first.input.headerRow));
          held.set(hintKey(sheet, pick.headerRow), { sheet, hint: hintOfPick(pick), send: true });
          if (isCurrentHeader(first, pick)) {
            // Mark every part as read under a hint, so the block goes out with the person's pick.
            blocks = blocks.map((b) => (q.blocks.includes(b) && b.meta ? { ...b, meta: { ...b.meta, hints: hintOfPick(pick) } } : b));
            break;
          }
        } else {
          // A table that continues the one above: the upper one is read again to the last row of this one.
          if (!upper || ids.has(upper.input.ordinal) || !first.meta) {
            held = before;
            hintError = true;
            continue;
          }
          const last = Math.max(...q.blocks.map((b) => b.meta?.lastDataRow ?? 0));
          const own = held.get(hintKey(sheetOf(upper), upper.meta!.guess.headerRow))?.hint ?? upper.meta!.guess;
          const hint: EngineHints = { ...own, headerRows: own.headerRows ?? 1, lastDataRow: last };
          // The title above the lower table ("December") is not data in either case; for "same columns" the repeated
          // names are not either.
          const skip = [...first.meta.titleRows];
          if (reply.kind === "same") {
            const from = first.meta.guess.headerRow;
            for (let k = 0; k < (first.meta.guess.headerRows ?? 1); k += 1) skip.push(from + k);
          }
          if (skip.length > 0) hint.skipRows = skip;
          held.delete(hintKey(sheet, first.meta.guess.headerRow));
          held.set(hintKey(sheetOf(upper), upper.meta!.guess.headerRow), { sheet: sheetOf(upper), hint, send: true });
          for (const b of q.blocks) joined.set(b.input.ordinal, b);
          if (await readAgain()) {
            for (const b of q.blocks) skipped.add(b.input.ordinal);
            break;
          }
          for (const b of q.blocks) joined.delete(b.input.ordinal);
          held = before;
          hintError = true;
          continue;
        }
        if (await readAgain()) break;
        held = before;
        hintError = true;
      }
    }
    deps.asked?.();
  }
  throw new Error("The header of this file could not be settled");
}

/** The table a following table is under: the block of its sheet that `follows` names. */
function upperOf(blocks: readonly ReadBlock[], b: ReadBlock): ReadBlock | undefined {
  const f = b.meta?.follows;
  if (!f) return undefined;
  return blocks.find((x) => sheetOf(x) === sheetOf(b) && x.meta?.tableIndex === f.block && x.meta.part === 0);
}
