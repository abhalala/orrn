import type { AgeingReportRow } from "@orrn/server/lib/ageingContracts";

/** The company calendar day (YYYY-MM-DD) of an instant, in its time zone. */
export function dayOf(ms: number | null, timeZone: string): string {
  if (ms === null) return "-";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  }
}

export type GroupKey = "day" | "oven";
export type GroupTotal = { key: string; batches: number; loadedPcs: number; takenByPackPcs: number; remainingPcs: number; heldLines: number; lines: number };

/**
 * Totals of the rows on the page by production day or oven. A subtotal of what the page shows (the
 * server pages the report), not a figure of its own: loaded = taken + remaining + scrap + rework.
 */
export function groupRows(rows: readonly AgeingReportRow[], by: GroupKey, timeZone: string): GroupTotal[] {
  const map = new Map<string, GroupTotal & { seen: Set<string> }>();
  for (const r of rows) {
    const key = by === "day" ? dayOf(r.inAt, timeZone) : (r.ovenCode ?? "-");
    let g = map.get(key);
    if (!g) {
      g = { key, batches: 0, loadedPcs: 0, takenByPackPcs: 0, remainingPcs: 0, heldLines: 0, lines: 0, seen: new Set() };
      map.set(key, g);
    }
    if (!g.seen.has(r.batchNumber)) {
      g.seen.add(r.batchNumber);
      g.batches += 1;
    }
    g.lines += 1;
    g.loadedPcs += r.loadedPcs;
    g.takenByPackPcs += r.takenByPackPcs;
    g.remainingPcs += r.remainingPcs;
    if (r.held) g.heldLines += 1;
  }
  return [...map.values()].map(({ seen: _seen, ...g }) => g).sort((a, b) => a.key.localeCompare(b.key));
}

/** Pages of the server's csv answers glued into one file: one header, every row. */
export function joinCsvPages(pages: readonly string[]): string {
  if (pages.length === 0) return "";
  const [first, ...rest] = pages;
  const body = rest.map((p) => p.split(/\r\n/).slice(1).filter((l) => l !== "").join("\r\n")).filter((p) => p !== "");
  const head = first!.replace(/(\r\n)+$/, "");
  return `${[head, ...body].join("\r\n")}\r\n`;
}
