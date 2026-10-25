/**
 * Party test certificate (FP-PF-04, C30; platform spec §3 `test_certificate`, §6 standards). A
 * frozen snapshot per completed dispatch: lines grouped by section with alloy, temper, profile kind,
 * the BIS standard and CM/L (the pair snapshotted on the bundle at pack; legacy bundles without one
 * use the live pair, marked `as_of_issue`), and a chemistry summary from the latest spectro result
 * of each cast behind the dispatched bundles.
 *
 * Honest gaps: while the foundry has no result for a cast (or a bundle names no cast), chemistry is
 * `pending` (nothing tested) or `partial` (some bundles untested) and the snapshot says how many.
 * The certificate never prints cast numbers (Q39 extended to the party's documents; MCQ raised),
 * never a rate, never party-vs-FC kg, and is not a tax document.
 */
import { readFloorSettings, resolveStandard, type ProfileKind } from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatchItem } from "@orrn/db/schema/dispatch";
import { spectroResult } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { salesOrderLine } from "@orrn/db/schema/sales";
import { company } from "@orrn/db/schema/tenant";
import type { TestCertificateChemistry } from "@orrn/db/schema/portal";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { mapInChunks, type OrrnDb } from "./atomic";
import { companyTimezone, zonedYmd } from "./dayWindow";
import { addressText } from "./packingListSnapshot";

export const CERT_ELEMENTS = ["si", "fe", "cu", "mn", "mg", "zn", "ti", "cr", "al"] as const;
export type CertElement = (typeof CERT_ELEMENTS)[number];

export type CertLine = {
  sectionCode: string;
  item: string;
  alloy: string | null;
  temper: string | null;
  profileKind: ProfileKind | null;
  /** False on a legacy die with no profile kind: the solid pair was used (platform spec §6). */
  profileKindSet: boolean;
  standard: string | null;
  /** Blank CM/L prints no licence line: null here. */
  cml: string | null;
  /** `as_packed` = the pair frozen on the bundles; `as_of_issue` = live settings at issue (legacy stock). */
  standardSource: "as_packed" | "as_of_issue";
  bundles: number;
  pcs: number;
  weightG: number;
};

export type CertChemistry = {
  status: TestCertificateChemistry;
  /** pass / fail / incomplete over the results cited; null when none. */
  verdict: "pass" | "fail" | "incomplete" | null;
  /** Range over the tested casts, parts per million; null bounds when no result carries the element. */
  elements: { element: CertElement; minPpm: number | null; maxPpm: number | null }[];
  /** Alloy codes the foundry tested against (from the spectro limits snapshot). */
  alloys: string[];
  /** Bundles whose cast has a result / has none (or names no cast). */
  testedBundles: number;
  untestedBundles: number;
};

export type CertSnapshot = {
  version: 1;
  number: string;
  revision: number;
  /** Issue date on the company calendar. */
  issuedOn: string;
  company: { name: string; legalName: string | null; gstin: string | null; address: string | null; phone: string | null };
  customer: { name: string; gstin: string | null; address: string | null };
  dispatch: { code: string; completedOn: string | null; plNumber: string | null; invoiceNumber: string | null };
  lines: CertLine[];
  totals: { bundles: number; pcs: number; weightG: number };
  chemistry: CertChemistry;
  /** Printed footer: a quality document, not a tax invoice. */
  notTaxDocument: true;
};

type DispatchForCert = {
  id: string;
  code: string;
  customerId: string;
  completedAt: Date | null;
  plNumber: string | null;
  invoiceNumber: string | null;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymdOf = (tz: string, ms: number) => {
  const d = zonedYmd(tz, ms);
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
};
const blankToNull = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());

/** Build the frozen snapshot (reads only; the caller allocates the number and writes the row). */
export async function buildCertificateSnapshot(
  db: OrrnDb,
  companyId: string,
  dispatchRow: DispatchForCert,
  opts: { number: string; revision: number; at: Date },
): Promise<CertSnapshot> {
  const [[co], [cust], items] = await Promise.all([
    db.select({ name: company.name, settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1),
    db
      .select({ name: customer.name, taxId: customer.taxId, billing: customer.billingAddress })
      .from(customer)
      .where(and(eq(customer.id, dispatchRow.customerId), eq(customer.companyId, companyId)))
      .limit(1),
    db
      .select({
        bundleId: bundle.id,
        quantity: bundle.quantity,
        weightG: bundle.weightG,
        castId: bundle.castId,
        bisStandard: bundle.bisStandard,
        cmlNo: bundle.cmlNo,
        sectionCode: die.sectionCode,
        series: die.series,
        sectionName: die.name,
        profileKind: die.profileKind,
        dieAlloy: die.alloy,
        dieTemper: die.temper,
        lineAlloy: salesOrderLine.alloy,
        lineTemper: salesOrderLine.temper,
      })
      .from(dispatchItem)
      .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, companyId)))
      .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, companyId)))
      .leftJoin(
        salesOrderLine,
        and(eq(salesOrderLine.id, dispatchItem.salesOrderLineId), eq(salesOrderLine.companyId, companyId)),
      )
      .where(and(eq(dispatchItem.dispatchId, dispatchRow.id), eq(dispatchItem.companyId, companyId))),
  ]);
  const settings = (co?.settings ?? {}) as Record<string, unknown>;
  const floor = readFloorSettings(settings);
  const tz = companyTimezone(settings);

  // Lines: one per (section, alloy, temper, kind, pair, source).
  const lines = new Map<string, CertLine>();
  for (const it of items) {
    const kind = (it.profileKind ?? null) as ProfileKind | null;
    const packed = blankToNull(it.bisStandard);
    const live = packed ? null : resolveStandard(floor.standards, kind);
    const standard = packed ?? blankToNull(live?.standard);
    const cml = packed ? blankToNull(it.cmlNo) : blankToNull(live?.cml);
    const source: CertLine["standardSource"] = packed ? "as_packed" : "as_of_issue";
    const alloy = blankToNull(it.lineAlloy) ?? blankToNull(it.dieAlloy);
    const temper = blankToNull(it.lineTemper) ?? blankToNull(it.dieTemper);
    const key = JSON.stringify([it.sectionCode, alloy, temper, kind, standard, cml, source]);
    const line = lines.get(key) ?? {
      sectionCode: it.sectionCode,
      item: it.sectionName?.trim() || `${it.series} ${it.sectionCode}`,
      alloy,
      temper,
      profileKind: kind,
      profileKindSet: kind !== null,
      standard,
      cml,
      standardSource: source,
      bundles: 0,
      pcs: 0,
      weightG: 0,
    };
    line.bundles += 1;
    line.pcs += it.quantity;
    line.weightG += it.weightG;
    lines.set(key, line);
  }
  const lineList = [...lines.values()].sort((a, b) =>
    a.sectionCode.localeCompare(b.sectionCode, "en", { numeric: true }) || (a.alloy ?? "").localeCompare(b.alloy ?? ""),
  );

  // Chemistry: the latest live spectro result of each cast behind the bundles.
  const castIds = [...new Set(items.map((i) => i.castId).filter((c): c is string => Boolean(c)))];
  const results = await mapInChunks(castIds, (part) =>
    db
      .select({
        castId: spectroResult.castId,
        createdAt: spectroResult.createdAt,
        verdict: spectroResult.verdict,
        limits: spectroResult.limitsSnapshot,
        si: spectroResult.siPpm,
        fe: spectroResult.fePpm,
        cu: spectroResult.cuPpm,
        mn: spectroResult.mnPpm,
        mg: spectroResult.mgPpm,
        zn: spectroResult.znPpm,
        ti: spectroResult.tiPpm,
        cr: spectroResult.crPpm,
        al: spectroResult.alPpm,
      })
      .from(spectroResult)
      .where(and(eq(spectroResult.companyId, companyId), inArray(spectroResult.castId, part), isNull(spectroResult.voidedAt)))
      .orderBy(desc(spectroResult.createdAt)),
  );
  const latestByCast = new Map<string, (typeof results)[number]>();
  for (const r of results) {
    if (!r.castId) continue;
    const prev = latestByCast.get(r.castId);
    if (!prev || r.createdAt.getTime() > prev.createdAt.getTime()) latestByCast.set(r.castId, r);
  }
  const tested = [...latestByCast.values()];
  const testedBundles = items.filter((i) => i.castId && latestByCast.has(i.castId)).length;
  const untestedBundles = items.length - testedBundles;
  const elements = CERT_ELEMENTS.map((element) => {
    const vals = tested.map((r) => r[element]).filter((v): v is number => v != null);
    return { element, minPpm: vals.length ? Math.min(...vals) : null, maxPpm: vals.length ? Math.max(...vals) : null };
  });
  const verdicts = tested.map((r) => r.verdict);
  const verdict: CertChemistry["verdict"] = tested.length === 0
    ? null
    : verdicts.includes("fail")
      ? "fail"
      : verdicts.every((v) => v === "pass")
        ? "pass"
        : "incomplete";
  const status: TestCertificateChemistry =
    testedBundles === 0 ? "pending" : untestedBundles > 0 ? "partial" : "ready";

  return {
    version: 1,
    number: opts.number,
    revision: opts.revision,
    issuedOn: ymdOf(tz, opts.at.getTime()),
    company: {
      name: co?.name ?? "",
      legalName: floor.letterhead.legalName,
      gstin: floor.letterhead.gstin,
      address: floor.letterhead.address,
      phone: floor.letterhead.phone,
    },
    customer: { name: cust?.name ?? "", gstin: cust?.taxId ?? null, address: addressText(cust?.billing ?? null) },
    dispatch: {
      code: dispatchRow.code,
      completedOn: dispatchRow.completedAt ? ymdOf(tz, dispatchRow.completedAt.getTime()) : null,
      plNumber: dispatchRow.plNumber,
      invoiceNumber: dispatchRow.invoiceNumber,
    },
    lines: lineList,
    totals: {
      bundles: items.length,
      pcs: items.reduce((s, i) => s + i.quantity, 0),
      weightG: items.reduce((s, i) => s + i.weightG, 0),
    },
    chemistry: {
      status,
      verdict,
      elements,
      alloys: [...new Set(tested.map((r) => r.limits?.alloyCode).filter((a): a is string => Boolean(a)))].sort(),
      testedBundles,
      untestedBundles,
    },
    notTaxDocument: true,
  };
}
