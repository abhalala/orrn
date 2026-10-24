/**
 * A cheap guard against importing the same sheet twice.
 *
 * Request ids make a resend of the same chunk safe, but a corrected copy of a
 * sheet changes chunk content, gets new ids, and would add every good row a
 * second time (duplicate old bundles, phantom stock). Old bundles carry no
 * legacy serial in the import, so the server cannot tell them apart; this
 * browser remembers each row it saved, by (company, kind, sheet row number,
 * values), and the next import marks those rows "already imported" instead of
 * sending them. Same row number AND same values: a different file with a
 * bundle of the same weight on another row is untouched.
 *
 * It is a convenience, not a lock: another browser or a cleared cache does not
 * know, and the done screen still tells the person to import only the
 * downloaded problem rows.
 */
import type { ImportKind, RejectedRow } from "./parse";
import type { ImportOp } from "./submit";

/** Newest fingerprints kept per company and kind (about 11 characters each). */
export const IMPORTED_ROWS_CAP = 60_000;

const key = (companyId: string, kind: ImportKind) => `orrn.importedRows.v1.${companyId}.${kind}`;

/** cyrb53: a fast 53-bit string hash. Collisions at this scale are not a practical concern. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function rowFingerprint(kind: ImportKind, row: number, data: unknown): string {
  return hash(JSON.stringify([kind, row, data]));
}

function read(storage: Storage | null, companyId: string, kind: ImportKind): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key(companyId, kind));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function loadImportedRows(storage: Storage | null, companyId: string, kind: ImportKind): Set<string> {
  return new Set(read(storage, companyId, kind));
}

/** Remembers the rows a call saved (or answered `replayed` for). Never throws. */
export function rememberImportedRows(storage: Storage | null, companyId: string, kind: ImportKind, ops: readonly ImportOp[]): void {
  if (!storage) return;
  try {
    const merged = [...new Set([...read(storage, companyId, kind), ...ops.map((o) => rowFingerprint(kind, o.row, o.data))])];
    storage.setItem(key(companyId, kind), JSON.stringify(merged.slice(-IMPORTED_ROWS_CAP)));
  } catch {
    // Private mode or quota: the guard is a convenience.
  }
}

/** Splits the rows to send from the rows this browser already imported (they become problem rows). */
export function splitAlreadyImported<O extends ImportOp>(
  kind: ImportKind,
  ops: readonly O[],
  imported: ReadonlySet<string>,
  column: string,
): { ops: O[]; blocked: RejectedRow[] } {
  if (imported.size === 0) return { ops: [...ops], blocked: [] };
  const send: O[] = [];
  const blocked: RejectedRow[] = [];
  for (const op of ops) {
    if (imported.has(rowFingerprint(kind, op.row, op.data))) {
      blocked.push({ row: op.row, reason: "imports.reason.alreadyImported", column });
    } else {
      send.push(op);
    }
  }
  return { ops: send, blocked };
}
