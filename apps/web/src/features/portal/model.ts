/**
 * View models for the party portal (FP-PF-01..04). Everything here is pure: the server's figures
 * (grams, pieces, milli kg/12 ft) are written down, never recomputed, and the order form builds the
 * one payload `portal.orders.create` takes (section, cut length, pieces OR kg; never a rate, a copy
 * or a tier).
 */
import { lengthFromInput, type LengthUnit } from "@orrn/domain";
import type { StatusTone } from "@orrn/domain";
import type { Locale } from "@orrn/i18n";

import { parseKgG, parsePieces } from "@/features/orders/line-model";

export const PORTAL_MAX_LINES = 20;

export type PortalOrderStatus = "booking" | "confirmed" | "dispatching" | "closed" | "cancelled";

export const PORTAL_STATUS_TONE: Record<PortalOrderStatus, StatusTone> = {
  booking: "neutral",
  confirmed: "blue",
  dispatching: "amber",
  closed: "green",
  cancelled: "red",
};

export function isPortalOrderStatus(v: unknown): v is PortalOrderStatus {
  return typeof v === "string" && v in PORTAL_STATUS_TONE;
}

/** Grams as kg to the gram ("1,280.000"), Indian grouping, like the plant's own order screens. */
const KG = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const PCS = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const kgText = (grams: number) => KG.format(grams / 1000);
export const pcsText = (pcs: number) => PCS.format(pcs);
/** Grams per 12 ft as kg ("14.700"). */
export const kgPer12ftText = (grams: number) => (grams / 1000).toFixed(3);

// ---------------------------------------------------------------------------
// Dies
// ---------------------------------------------------------------------------

export type BandPosition = "in" | "over" | "under";

/** Where a copy's latest weight sits against its band (grams per 12 ft). Null without a band or a reading. */
export function bandPosition(latestG: number | null, band: { minG: number; maxG: number } | null): { position: BandPosition; offG: number } | null {
  if (latestG == null || !band) return null;
  if (latestG > band.maxG) return { position: "over", offG: latestG - band.maxG };
  if (latestG < band.minG) return { position: "under", offG: band.minG - latestG };
  return { position: "in", offG: 0 };
}

export type PortalSection = {
  id: string;
  series: string;
  sectionCode: string;
  name: string | null;
  granted: boolean;
  owned: boolean;
};

/** "Domal 12170" style title: series then section code. */
export function sectionTitle(s: Pick<PortalSection, "series" | "sectionCode">): string {
  return `${s.series} ${s.sectionCode}`.trim();
}

/** The marker next to a section: yours (owned) wins over opened-for-you (granted). */
export function sectionMarker(s: Pick<PortalSection, "granted" | "owned">): "owned" | "granted" | null {
  return s.owned ? "owned" : s.granted ? "granted" : null;
}

// ---------------------------------------------------------------------------
// Dispatches and the certificate
// ---------------------------------------------------------------------------

export type CertChemistryStatus = "pending" | "partial" | "ready";

export function chemistryNote(chem: { status: CertChemistryStatus; testedBundles: number; untestedBundles: number }): {
  key: "portal.certificate.chemistryPending" | "portal.certificate.chemistryPartial" | "portal.certificate.chemistryReady";
  vars: Record<string, number>;
} {
  if (chem.status === "pending") return { key: "portal.certificate.chemistryPending", vars: {} };
  if (chem.status === "partial") {
    return { key: "portal.certificate.chemistryPartial", vars: { tested: chem.testedBundles, total: chem.testedBundles + chem.untestedBundles } };
  }
  return { key: "portal.certificate.chemistryReady", vars: {} };
}

/** ppm to a percent as the lab sheet writes it: 4500 -> "0.450". */
export function ppmPercentText(ppm: number | null): string {
  return ppm == null ? "-" : (ppm / 10_000).toFixed(3);
}

/** The certificate's snapshot as the portal reads it (version 1 has no `casts`). */
export type CertCast = {
  castNo: string;
  bundles: number;
  pcs: number;
  weightG: number;
  tested: boolean;
  verdict: "pass" | "fail" | "incomplete" | null;
  alloy: string | null;
  elements: { element: string; ppm: number | null }[];
};

export type CertLine = {
  sectionCode: string;
  item: string;
  alloy: string | null;
  temper: string | null;
  standard: string | null;
  cml: string | null;
  standardSource: "as_packed" | "as_of_issue";
  profileKindSet: boolean;
  bundles: number;
  pcs: number;
  weightG: number;
};

export type CertSnapshot = {
  number: string;
  revision: number;
  issuedOn: string;
  company: { name: string; legalName: string | null; gstin: string | null; address: string | null; phone: string | null };
  customer: { name: string; gstin: string | null; address: string | null };
  dispatch: { code: string; completedOn: string | null; plNumber: string | null; invoiceNumber: string | null };
  lines: CertLine[];
  totals: { bundles: number; pcs: number; weightG: number };
  chemistry: {
    status: CertChemistryStatus;
    verdict: "pass" | "fail" | "incomplete" | null;
    alloys: string[];
    testedBundles: number;
    untestedBundles: number;
  };
  casts?: CertCast[];
};

/** Casts of a certificate; a version 1 snapshot (before casts were cited) has none. */
export function certCasts(snapshot: Pick<CertSnapshot, "casts">): CertCast[] {
  return Array.isArray(snapshot.casts) ? snapshot.casts : [];
}

// ---------------------------------------------------------------------------
// Locale
// ---------------------------------------------------------------------------

/**
 * The language the portal opens in: the person's own saved choice wins; otherwise the party's locale
 * the plant set (`portal.me.locale`).
 */
export function portalLocale(stored: Locale | null, plantLocale: Locale | null | undefined, current: Locale): Locale {
  if (stored) return stored;
  return plantLocale ?? current;
}

// ---------------------------------------------------------------------------
// New order form
// ---------------------------------------------------------------------------

export type PortalLineDraft = {
  key: string;
  sectionId: string;
  feet: string;
  inches: string;
  mm: string;
  /** Which side the party types: pieces or kg (the plant works out the other). */
  basis: "pcs" | "kg";
  qty: string;
  note: string;
};

export function newPortalLine(key: string, basis: "pcs" | "kg" = "pcs"): PortalLineDraft {
  return { key, sectionId: "", feet: "", inches: "", mm: "", basis, qty: "", note: "" };
}

export type PortalLineProblems = { section?: "portal.orders.errors.section"; length?: "portal.orders.errors.length"; qty?: "portal.orders.errors.qty" };

export function cutLengthOf(d: Pick<PortalLineDraft, "feet" | "inches" | "mm">, unit: LengthUnit): number | null {
  return lengthFromInput({ unit, mm: d.mm, feet: d.feet, inches: d.inches });
}

export function portalLineProblems(d: PortalLineDraft, unit: LengthUnit): PortalLineProblems {
  const out: PortalLineProblems = {};
  if (!d.sectionId) out.section = "portal.orders.errors.section";
  if (cutLengthOf(d, unit) == null) out.length = "portal.orders.errors.length";
  if ((d.basis === "pcs" ? parsePieces(d.qty) : parseKgG(d.qty)) == null) out.qty = "portal.orders.errors.qty";
  return out;
}

export type PortalOrderBody = {
  poNumber?: string;
  note?: string;
  lines: { sectionId: string; cutLengthMm: number; pcs?: number; kgG?: number; note?: string }[];
};

/** The `portal.orders.create` body, or null while any line is incomplete. One side per line, no rate. */
export function portalOrderBody(
  form: { po: string; note: string; lines: PortalLineDraft[] },
  unit: LengthUnit,
): PortalOrderBody | null {
  if (form.lines.length === 0 || form.lines.length > PORTAL_MAX_LINES) return null;
  const lines: PortalOrderBody["lines"] = [];
  for (const d of form.lines) {
    const cutLengthMm = cutLengthOf(d, unit);
    const qty = d.basis === "pcs" ? parsePieces(d.qty) : parseKgG(d.qty);
    if (!d.sectionId || cutLengthMm == null || qty == null) return null;
    lines.push({
      sectionId: d.sectionId,
      cutLengthMm,
      ...(d.basis === "pcs" ? { pcs: qty } : { kgG: qty }),
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    });
  }
  return { ...(form.po.trim() ? { poNumber: form.po.trim() } : {}), ...(form.note.trim() ? { note: form.note.trim() } : {}), lines };
}

/**
 * A retry after an unsure answer must send the same request id (the server then replays instead of
 * booking twice); an edited form gets a fresh one.
 */
export function requestIdFor(previous: { id: string; body: string } | null, body: unknown, makeId: () => string): { id: string; body: string } {
  const json = JSON.stringify(body);
  return previous && previous.body === json ? previous : { id: makeId(), body: json };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PortalErrorKey =
  | "portal.errors.notFound"
  | "portal.errors.disabled"
  | "portal.errors.noAccess"
  | "portal.errors.wrongPlant"
  | "portal.errors.member"
  | "errors.generic"
  | "errors.network";

/** The party's words for a refusal. The server's English message picks the reason; the screen says it in the party's language. */
export function portalErrorKey(error: unknown): PortalErrorKey {
  const e = error as { message?: unknown; data?: { code?: unknown } } | null;
  const code = e?.data?.code;
  const message = typeof e?.message === "string" ? e.message : "";
  if (code === "NOT_FOUND") return "portal.errors.notFound";
  if (code === "FORBIDDEN") {
    if (/party portal is off/i.test(message)) return "portal.errors.disabled";
    if (/access to that plant/i.test(message)) return "portal.errors.wrongPlant";
    if (/works in the plant/i.test(message)) return "portal.errors.member";
    return "portal.errors.noAccess";
  }
  if (/fetch|network/i.test(message)) return "errors.network";
  return "errors.generic";
}
