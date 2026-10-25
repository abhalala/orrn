/**
 * Party test certificate (FP-PF-04, C30; platform spec §3 `test_certificate`, §6 standards). A
 * frozen snapshot per completed dispatch: lines grouped by section with alloy, temper, profile kind,
 * the BIS standard and CM/L (the pair snapshotted on the bundle at pack; legacy bundles without one
 * use the live pair, marked `as_of_issue`), and a chemistry summary from the latest spectro result
 * of each cast behind the dispatched bundles.
 *
 * Casts (D28, C30): the certificate cites every cast behind the dispatched bundles by its number
 * (`K31`) with that cast's own chemistry from its latest live spectro result, each element in ppm and
 * as a percentage to 3 decimals, and the verdict. A cast the foundry has not tested yet is listed as
 * `pending` ("chemistry pending"); a cast whose result failed is listed as `failed`, never hidden (the
 * plant decides whether to dispatch it; issuing is not refused). Bundles that name no cast are counted
 * apart (`noCastBundles`). Q39 ("no cast numbers") applies to the customer packing list only.
 *
 * Summary status: `pending` (no bundle's cast tested), `partial` (some bundles untested), `ready`.
 * Never a rate, never party-vs-FC kg, never a die band; not a tax document.
 */
import { decidingSpectro, readFloorSettings, resolveStandard, type ProfileKind } from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatchItem } from "@orrn/db/schema/dispatch";
import { cast, spectroResult } from "@orrn/db/schema/foundry";
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

/** One element of one cast's result: ppm as measured (Al may be the balance) and % to 3 decimals. */
export type CertCastElement = {
  element: CertElement;
  ppm: number | null;
  /** `ppm / 10 000` with 3 decimals as printed (4 500 ppm -> "0.450"); null when not measured. */
  pct: string | null;
};

/**
 * One cast behind the dispatched bundles. `tested` = latest result passes or is incomplete; `failed` =
 * latest result failed (shown, never hidden); `pending` = no live result yet ("chemistry pending").
 */
export type CertCast = {
  /** The cast number as staff write it (`K31`). */
  castNo: string;
  /** Alloy the result was tested against (limits snapshot), else the cast's alloy. */
  alloy: string | null;
  status: "tested" | "failed" | "pending";
  verdict: "pass" | "fail" | "incomplete" | null;
  bundles: number;
  pcs: number;
  weightG: number;
  sectionCodes: string[];
  /** Al worked out as 1 000 000 - the other eight (not measured). */
  alBalance: boolean;
  /** Empty while pending. */
  elements: CertCastElement[];
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
  /** Bundles that name no cast (legacy stock, or cast not required at pack). */
  noCastBundles: number;
  /** Casts whose latest result failed (each also listed in `casts` as `failed`). */
  failedCasts: number;
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
  /** Every cast behind the bundles, in cast order, with its own chemistry (D28). */
  casts: CertCast[];
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

/** ppm -> percent with 3 decimals as printed (1 % = 10 000 ppm). */
export function ppmToPct(ppm: number | null | undefined): string | null {
  return ppm == null ? null : (ppm / 10_000).toFixed(3);
}

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
  const [castRows, results] = await Promise.all([
    mapInChunks(castIds, (part) =>
      db
        .select({ id: cast.id, number: cast.number, alloy: cast.alloy, year: cast.year, month: cast.month, seq: cast.seq })
        .from(cast)
        .where(and(eq(cast.companyId, companyId), inArray(cast.id, part))),
    ),
    mapInChunks(castIds, (part) =>
      db
        .select({
          castId: spectroResult.castId,
          createdAt: spectroResult.createdAt,
          valuesPpm: spectroResult.valuesPpm,
          verdict: spectroResult.verdict,
          limits: spectroResult.limitsSnapshot,
          alSource: spectroResult.alSource,
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
    ),
  ]);
  // The result that decides a cast is `decidingSpectro` (BACKLOG 79): the latest live result that carries numbers.
  // A photo of a printout has none and judges `incomplete`; it never replaces typed numbers that passed.
  // A row has numbers when `values_ppm` has keys or any per-element column is filled (typed rows fill both).
  const byCast = new Map<string, (typeof results)[number][]>();
  for (const r of results) {
    if (!r.castId) continue;
    const list = byCast.get(r.castId);
    if (list) list.push(r);
    else byCast.set(r.castId, [r]);
  }
  const hasNumbers = (r: (typeof results)[number]) =>
    Object.keys(r.valuesPpm ?? {}).length > 0 || CERT_ELEMENTS.some((element) => r[element] != null);
  const latestByCast = new Map<string, (typeof results)[number]>();
  for (const [castId, list] of byCast) {
    // oldest to newest, as `decidingSpectro` reads them (the query already dropped voided rows)
    const oldestFirst = list.map((r) => ({ r, values: hasNumbers(r) ? { n: 1 } : {} })).sort((a, b) => a.r.createdAt.getTime() - b.r.createdAt.getTime());
    const deciding = decidingSpectro(oldestFirst);
    if (deciding) latestByCast.set(castId, deciding.r);
  }
  const tested = [...latestByCast.values()];
  const testedBundles = items.filter((i) => i.castId && latestByCast.has(i.castId)).length;
  const untestedBundles = items.length - testedBundles;
  const noCastBundles = items.filter((i) => !i.castId).length;
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

  // Per cast (D28): number, its bundles and sections, and its own result (or pending).
  const castById = new Map(castRows.map((c) => [c.id, c]));
  const casts: (CertCast & { order: [number, number, number, string] })[] = castIds.map((castId) => {
    const row = castById.get(castId);
    const mine = items.filter((i) => i.castId === castId);
    const r = latestByCast.get(castId);
    const castVerdict = (r?.verdict ?? null) as CertCast["verdict"];
    return {
      castNo: row?.number ?? "",
      alloy: blankToNull(r?.limits?.alloyCode) ?? blankToNull(row?.alloy),
      status: !r ? "pending" : castVerdict === "fail" ? "failed" : "tested",
      verdict: r ? castVerdict : null,
      bundles: mine.length,
      pcs: mine.reduce((sum, i) => sum + i.quantity, 0),
      weightG: mine.reduce((sum, i) => sum + i.weightG, 0),
      sectionCodes: [...new Set(mine.map((i) => i.sectionCode))].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
      alBalance: r?.alSource === "balance",
      elements: r ? CERT_ELEMENTS.map((element) => ({ element, ppm: r[element] ?? null, pct: ppmToPct(r[element]) })) : [],
      order: [row?.year ?? 0, row?.month ?? 0, row?.seq ?? 0, row?.number ?? ""],
    };
  });
  casts.sort((a, b) => {
    for (let i = 0; i < 3; i += 1) {
      const d = (a.order[i] as number) - (b.order[i] as number);
      if (d !== 0) return d;
    }
    return a.order[3].localeCompare(b.order[3], "en", { numeric: true });
  });
  const castList: CertCast[] = casts.map(({ order: _order, ...c }) => c);

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
      noCastBundles,
      failedCasts: castList.filter((c) => c.status === "failed").length,
    },
    casts: castList,
    notTaxDocument: true,
  };
}
