import { billetCutFigures, parseDecimal } from "@orrn/domain";

import { kgToG } from "./melt-form";

/** URL search and form logic of `/foundry/billets` (billet cutting, issue and floor stock). Pure: no React. */

export const BILLET_TABS = ["stock", "cut", "issue"] as const;
export type BilletTab = (typeof BILLET_TABS)[number];
export type BilletsSearch = { tab?: Exclude<BilletTab, "stock"> };

/** `/foundry/billets?tab=cut` (the stock tab stays out of the URL). Plain function: no zod in the route chunk. */
export function parseBilletsSearch(raw: Record<string, unknown>): BilletsSearch {
  return raw.tab === "cut" || raw.tab === "issue" ? { tab: raw.tab } : {};
}
export const tabOf = (s: BilletsSearch): BilletTab => s.tab ?? "stock";

// --- Places ------------------------------------------------------------------------------------------

export type PlaceKind = "billet_store" | "billet_rack" | "press_floor";
export type StockCast = { castId: string; number: string; alloy: string; source: "melt" | "bought_in"; kgG: number };
export type StockPlace = { id: string; code: string; name: string; kind: PlaceKind; pressLineId: string | null; pressLineCode: string | null; active: boolean; kgG: number; casts: StockCast[] };
export type PressLine = { id: string; code: string; name: string; status: string };

export type PlaceGroups = {
  store: StockPlace[];
  rack: StockPlace[];
  /** One section per press line (lines with no floor still show, empty), then floors that name no press. */
  floors: { key: string; pressLineId: string | null; code: string | null; places: StockPlace[]; kgG: number }[];
};

/** Billet places grouped by kind; the press floors grouped by the press they serve (row 50). Retired empty places drop out. */
export function groupPlaces(places: readonly StockPlace[], lines: readonly PressLine[]): PlaceGroups {
  const live = places.filter((p) => p.active || p.kgG !== 0);
  const floors = live.filter((p) => p.kind === "press_floor");
  const sections = lines.map((l) => {
    const mine = floors.filter((p) => p.pressLineId === l.id);
    return { key: l.id, pressLineId: l.id as string | null, code: l.code as string | null, places: mine, kgG: mine.reduce((t, p) => t + p.kgG, 0) };
  });
  const known = new Set(lines.map((l) => l.id));
  const loose = floors.filter((p) => !p.pressLineId || !known.has(p.pressLineId));
  if (loose.length > 0) sections.push({ key: "none", pressLineId: null, code: null, places: loose, kgG: loose.reduce((t, p) => t + p.kgG, 0) });
  return { store: live.filter((p) => p.kind === "billet_store"), rack: live.filter((p) => p.kind === "billet_rack"), floors: sections };
}

/** A cast lying at one place: one pick in the cut, issue and reject sheets. */
export type CastAtPlace = { value: string; castId: string; number: string; alloy: string; locationId: string; locationCode: string; kind: PlaceKind; kgG: number };

/** Casts on hand (kg above zero) at places of the given kinds, by cast number. Value is `castId:locationId`. */
export function castsAt(places: readonly StockPlace[], kinds: readonly PlaceKind[]): CastAtPlace[] {
  return places
    .filter((p) => kinds.includes(p.kind) && p.active)
    .flatMap((p) => p.casts.filter((c) => c.kgG > 0).map((c) => ({ value: `${c.castId}:${p.id}`, castId: c.castId, number: c.number, alloy: c.alloy, locationId: p.id, locationCode: p.code, kind: p.kind, kgG: c.kgG })))
    .sort((a, b) => a.number.localeCompare(b.number) || a.locationCode.localeCompare(b.locationCode));
}

// --- Cut -------------------------------------------------------------------------------------------------

export const CUT_MACHINES = ["saw", "hot_shear"] as const;
export type CutMachine = (typeof CUT_MACHINES)[number];

export type CutDraft = { cast: string; machine: CutMachine; logPcs: string; logKg: string; lengthMm: string; billetPcs: string; billetKg: string };
export const blankCut = (): CutDraft => ({ cast: "", machine: "saw", logPcs: "", logKg: "", lengthMm: "", billetPcs: "", billetKg: "" });

export type CutIssue = "cast" | "logPcs" | "logKg" | "lengthMm" | "billetPcs" | "billetKg" | "more_out_than_in" | "length_range" | "more_than_stock";

/** Whole pieces, 1 to 100,000 (the server's bound); null for anything else. */
export function pcsOf(text: string): number | null {
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null;
}
/** The typed length in mm (the box's draft is mm), whole; null for blank or not a number. */
export function mmOf(text: string): number | null {
  const n = parseDecimal(text);
  return n === null ? null : Math.round(n);
}

export type CutCheck =
  | { ok: true; endG: number; yieldBp: number; input: { castId: string; machine: CutMachine; logPcs: number; logG: number; billetLengthMm: number; billetPcs: number; billetG: number; fromLocationId: string } }
  | { ok: false; issue: CutIssue };

/**
 * The cut form against the stock: `casts` are the logs in the billet store (`castsAt`). The figures come from the domain's
 * `billetCutFigures` (the server runs the same), so the preview and the refusal agree.
 */
export function checkCut(d: CutDraft, casts: readonly CastAtPlace[]): CutCheck {
  const pick = casts.find((c) => c.value === d.cast);
  if (!pick) return { ok: false, issue: "cast" };
  const logPcs = pcsOf(d.logPcs);
  if (logPcs === null) return { ok: false, issue: "logPcs" };
  const logG = kgToG(d.logKg);
  if (logG === null || logG <= 0) return { ok: false, issue: "logKg" };
  const billetLengthMm = mmOf(d.lengthMm);
  if (billetLengthMm === null) return { ok: false, issue: "lengthMm" };
  const billetPcs = pcsOf(d.billetPcs);
  if (billetPcs === null) return { ok: false, issue: "billetPcs" };
  const billetG = kgToG(d.billetKg);
  if (billetG === null || billetG <= 0) return { ok: false, issue: "billetKg" };
  const f = billetCutFigures({ logPcs, logG, billetPcs, billetG, billetLengthMm });
  if (!f.ok) return { ok: false, issue: f.error === "no_logs" ? "logKg" : f.error === "no_billets" ? "billetKg" : f.error };
  if (logG > pick.kgG) return { ok: false, issue: "more_than_stock" };
  return { ok: true, endG: f.endG, yieldBp: f.yieldBp, input: { castId: pick.castId, machine: d.machine, logPcs, logG, billetLengthMm, billetPcs, billetG, fromLocationId: pick.locationId } };
}

/** Live end-cut weight and yield while the form fills in: only the two weights are needed. */
export function cutPreview(d: Pick<CutDraft, "logKg" | "billetKg">): { endG: number; yieldBp: number } | null {
  const logG = kgToG(d.logKg);
  const billetG = kgToG(d.billetKg);
  if (logG === null || billetG === null || logG <= 0 || billetG <= 0 || billetG > logG) return null;
  return { endG: logG - billetG, yieldBp: Math.floor((billetG * 10_000) / logG) };
}

/** 9,412 bp -> "94.1". */
export const yieldText = (bp: number | null | undefined): string => (bp === null || bp === undefined ? "-" : (bp / 100).toFixed(1));

/** The server's homogenizing refusal ("Homogenize the logs of K31 before cutting them", "Only 3 logs of K31 have been homogenized and not cut"). */
export const isHomogRefusal = (message: unknown): boolean => typeof message === "string" && /homogeni[sz]/i.test(message);

// --- Issue -----------------------------------------------------------------------------------------------

export type IssueDraft = { cast: string; pressLineId: string; pcs: string; kg: string };
export const blankIssue = (): IssueDraft => ({ cast: "", pressLineId: "", pcs: "", kg: "" });
export type IssueIssue = "cast" | "press" | "pcs" | "kg" | "more_than_stock";

export type IssueCheck = { ok: true; input: { castId: string; pressLineId: string; fromLocationId: string; pcs: number; kgG: number } } | { ok: false; issue: IssueIssue };

/** The issue form against the rack stock (`castsAt(places, ["billet_rack"])`) and the lines that have a floor. */
export function checkIssue(d: IssueDraft, casts: readonly CastAtPlace[]): IssueCheck {
  const pick = casts.find((c) => c.value === d.cast);
  if (!pick) return { ok: false, issue: "cast" };
  if (!d.pressLineId) return { ok: false, issue: "press" };
  const pcs = pcsOf(d.pcs);
  if (pcs === null) return { ok: false, issue: "pcs" };
  const kgG = kgToG(d.kg);
  if (kgG === null || kgG <= 0 || kgG > 100_000_000) return { ok: false, issue: "kg" };
  if (kgG > pick.kgG) return { ok: false, issue: "more_than_stock" };
  return { ok: true, input: { castId: pick.castId, pressLineId: d.pressLineId, fromLocationId: pick.locationId, pcs, kgG } };
}

/** Press lines that have an active floor, so the issue sheet offers only presses the server will accept. */
export function linesWithFloor(lines: readonly PressLine[], places: readonly Pick<StockPlace, "kind" | "pressLineId" | "active">[]): PressLine[] {
  const have = new Set(places.filter((p) => p.kind === "press_floor" && p.active && p.pressLineId).map((p) => p.pressLineId));
  return lines.filter((l) => have.has(l.id));
}
