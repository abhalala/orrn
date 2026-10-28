import { and, asc, desc, eq, isNull, lte, notInArray } from "drizzle-orm";

import type { OrrnDb } from "@orrn/db";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieBand, dieFile, dieInstance } from "@orrn/db/schema/dies";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle, bundleGroup } from "@orrn/db/schema/inventory";
import { printerProfile, printLog } from "@orrn/db/schema/printing";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { edgeSnapshot, edgeSnapshotChunk } from "@orrn/db/schema/spool";
import { location } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";
import {
  type EdgeSnapshotChunkPayload,
  type EdgeSnapshotManifest,
  type EdgeSnapshotRecordItem,
  type EdgeSnapshotSection,
  type EdgeSnapshotSectionDescriptor,
  edgeSnapshotSections,
} from "@orrn/edge-runtime";

export const EDGE_SNAPSHOT_CACHE_TTL_MS = 60_000;
export const EDGE_SNAPSHOT_MAX_CHUNK_BYTES = 900 * 1024; // <= 1 MiB UTF-8 JSON per chunk
export const EDGE_SNAPSHOT_MIN_RETENTION_MS = 24 * 60 * 60_000;
export const EDGE_SNAPSHOT_MIN_AGENT_VERSION = "1.0.0";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function compareUtf8(a: string, b: string): number {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const difference = left[i]! - right[i]!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/**
 * Snapshot digest canonicalization shared by contract with the Go cache:
 * UTF-8 JSON without whitespace, arrays in wire order, and object keys sorted
 * recursively by UTF-8 bytes. Numbers, strings, booleans, and null retain their
 * JSON values. U+2028/U+2029 escaping matches Go's JSON encoder.
 */
export function canonicalizeEdgeSnapshotDocument(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeEdgeSnapshotDocument(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareUtf8)
    .map((key) => {
      const canonicalKey = JSON.stringify(key).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      return `${canonicalKey}:${canonicalizeEdgeSnapshotDocument(record[key])}`;
    })
    .join(",")}}`;
}

/** The chunk hash covers every actual wire field except the top-level hash itself. */
export function edgeSnapshotUnsignedChunkDocument(
  payload: EdgeSnapshotChunkPayload,
): Omit<EdgeSnapshotChunkPayload, "sha256"> {
  const { sha256: _sha256, ...unsigned } = payload;
  return unsigned;
}

type BuiltSectionData = {
  records: EdgeSnapshotRecordItem[];
  summaries: Array<Record<string, unknown>>;
};

async function buildStockSection(db: OrrnDb, companyId: string): Promise<BuiltSectionData> {
  const [bundles, dies, locations, groups] = await db.batch([
    db
      .select({
        id: bundle.id,
        serial: bundle.serial,
        groupId: bundle.groupId,
        dieId: bundle.dieId,
        dieInstanceId: bundle.dieInstanceId,
        locationId: bundle.locationId,
        salesOrderLineId: bundle.salesOrderLineId,
        heldForLineId: bundle.heldForLineId,
        partyNo: bundle.partyNo,
        stickerStale: bundle.stickerStale,
        quantity: bundle.quantity,
        weightG: bundle.weightG,
        lengthMm: bundle.lengthMm,
        kgPer12ftMilli: bundle.kgPer12ftMilli,
        status: bundle.status,
        createdAt: bundle.createdAt,
        updatedAt: bundle.updatedAt,
      })
      .from(bundle)
      .where(eq(bundle.companyId, companyId))
      .orderBy(asc(bundle.serial)),
    db
      .select({
        id: die.id,
        series: die.series,
        sectionCode: die.sectionCode,
        name: die.name,
        weightMinG: die.weightMinG,
        weightMaxG: die.weightMaxG,
      })
      .from(die)
      .where(eq(die.companyId, companyId)),
    db
      .select({
        id: location.id,
        code: location.code,
        name: location.name,
        kind: location.kind,
        active: location.active,
      })
      .from(location)
      .where(eq(location.companyId, companyId)),
    db
      .select({
        id: bundleGroup.id,
        code: bundleGroup.code,
      })
      .from(bundleGroup)
      .where(eq(bundleGroup.companyId, companyId)),
  ]);

  const dieMap = new Map(dies.map((d) => [d.id, d]));
  const locMap = new Map(locations.map((l) => [l.id, l]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const statusTotals: Record<string, { count: number; weightG: number; pieces: number }> = {};

  const records: EdgeSnapshotRecordItem[] = bundles.map((b) => {
    const d = dieMap.get(b.dieId);
    const loc = b.locationId ? locMap.get(b.locationId) : undefined;
    const grp = groupMap.get(b.groupId);

    const bucket = statusTotals[b.status] ?? { count: 0, weightG: 0, pieces: 0 };
    bucket.count += 1;
    bucket.weightG += b.weightG;
    bucket.pieces += b.quantity;
    statusTotals[b.status] = bucket;

    let bandVerdict: "in_band" | "under" | "over" | "unknown" = "unknown";
    if (d && b.kgPer12ftMilli != null) {
      if (b.kgPer12ftMilli < d.weightMinG) bandVerdict = "under";
      else if (b.kgPer12ftMilli > d.weightMaxG) bandVerdict = "over";
      else bandVerdict = "in_band";
    }

    return {
      entityId: b.id,
      sortKey: b.serial,
      dto: {
        id: b.id,
        serial: b.serial,
        groupCode: grp?.code ?? null,
        dieId: b.dieId,
        sectionCode: d?.sectionCode ?? null,
        sectionName: d?.name ?? null,
        series: d?.series ?? null,
        dieInstanceId: b.dieInstanceId ?? null,
        locationId: b.locationId ?? null,
        locationCode: loc?.code ?? null,
        locationName: loc?.name ?? null,
        salesOrderLineId: b.salesOrderLineId ?? null,
        heldForLineId: b.heldForLineId ?? null,
        partyNo: b.partyNo ?? b.serial,
        stickerStale: Boolean(b.stickerStale),
        quantity: b.quantity,
        weightG: b.weightG,
        lengthMm: b.lengthMm,
        kgPer12ftMilli: b.kgPer12ftMilli ?? null,
        bandMinG: d?.weightMinG ?? null,
        bandMaxG: d?.weightMaxG ?? null,
        bandVerdict,
        status: b.status,
        createdAt: b.createdAt ? b.createdAt.toISOString() : null,
        updatedAt: b.updatedAt ? b.updatedAt.toISOString() : null,
      },
    };
  });

  const summaries: Array<Record<string, unknown>> = [
    {
      kind: "stock_summary",
      totalBundles: bundles.length,
      statusTotals,
      locations: locations.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        kind: l.kind,
        active: Boolean(l.active),
      })),
    },
  ];

  return { records, summaries };
}

async function buildOrdersSection(db: OrrnDb, companyId: string): Promise<BuiltSectionData> {
  // Explicit projection on salesOrderLine omitting ratePaise and any price/rate fields
  const [orders, lines, customers, dies, bundles, completedDispatches, dispatchItems] = await db.batch([
    db
      .select({
        id: salesOrder.id,
        period: salesOrder.period,
        number: salesOrder.number,
        customerId: salesOrder.customerId,
        poNumber: salesOrder.poNumber,
        orderDate: salesOrder.orderDate,
        expectedDate: salesOrder.expectedDate,
        status: salesOrder.status,
        finish: salesOrder.finish,
        source: salesOrder.source,
        note: salesOrder.note,
        createdAt: salesOrder.createdAt,
        updatedAt: salesOrder.updatedAt,
      })
      .from(salesOrder)
      .where(eq(salesOrder.companyId, companyId))
      .orderBy(desc(salesOrder.orderDate), asc(salesOrder.number)),
    db
      .select({
        id: salesOrderLine.id,
        salesOrderId: salesOrderLine.salesOrderId,
        lineNo: salesOrderLine.lineNo,
        dieId: salesOrderLine.dieId,
        dieInstanceId: salesOrderLine.dieInstanceId,
        tierRank: salesOrderLine.tierRank,
        kgPer12ftMilli: salesOrderLine.kgPer12ftMilli,
        cutLengthMm: salesOrderLine.cutLengthMm,
        pcs: salesOrderLine.pcs,
        kgG: salesOrderLine.kgG,
        finish: salesOrderLine.finish,
        qtyBasis: salesOrderLine.qtyBasis,
        impliedG: salesOrderLine.impliedG,
        weightBasis: salesOrderLine.weightBasis,
        bandStartMilli: salesOrderLine.bandStartMilli,
        copyMilli: salesOrderLine.copyMilli,
        alloy: salesOrderLine.alloy,
        temper: salesOrderLine.temper,
        note: salesOrderLine.note,
      })
      .from(salesOrderLine)
      .where(eq(salesOrderLine.companyId, companyId))
      .orderBy(asc(salesOrderLine.lineNo)),
    db
      .select({
        id: customer.id,
        name: customer.name,
      })
      .from(customer)
      .where(eq(customer.companyId, companyId)),
    db
      .select({
        id: die.id,
        series: die.series,
        sectionCode: die.sectionCode,
        name: die.name,
      })
      .from(die)
      .where(eq(die.companyId, companyId)),
    db
      .select({
        id: bundle.id,
        salesOrderLineId: bundle.salesOrderLineId,
        weightG: bundle.weightG,
        quantity: bundle.quantity,
        status: bundle.status,
      })
      .from(bundle)
      .where(eq(bundle.companyId, companyId)),
    db
      .select({
        id: dispatch.id,
      })
      .from(dispatch)
      .where(and(eq(dispatch.companyId, companyId), eq(dispatch.status, "completed"))),
    db
      .select({
        dispatchId: dispatchItem.dispatchId,
        bundleId: dispatchItem.bundleId,
        salesOrderLineId: dispatchItem.salesOrderLineId,
      })
      .from(dispatchItem)
      .where(eq(dispatchItem.companyId, companyId)),
  ]);

  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const dieMap = new Map(dies.map((d) => [d.id, d]));
  const bundleWeightById = new Map(bundles.map((b) => [b.id, b]));
  const completedDispatchIds = new Set(completedDispatches.map((d) => d.id));

  const producedByLine = new Map<string, { weightG: number; pcs: number }>();
  for (const b of bundles) {
    if (!b.salesOrderLineId || b.status === "void") continue;
    const prev = producedByLine.get(b.salesOrderLineId) ?? { weightG: 0, pcs: 0 };
    prev.weightG += b.weightG;
    prev.pcs += b.quantity;
    producedByLine.set(b.salesOrderLineId, prev);
  }

  const dispatchedByLine = new Map<string, { weightG: number; pcs: number }>();
  for (const item of dispatchItems) {
    if (!item.salesOrderLineId || !completedDispatchIds.has(item.dispatchId)) continue;
    const b = bundleWeightById.get(item.bundleId);
    if (!b) continue;
    const prev = dispatchedByLine.get(item.salesOrderLineId) ?? { weightG: 0, pcs: 0 };
    prev.weightG += b.weightG;
    prev.pcs += b.quantity;
    dispatchedByLine.set(item.salesOrderLineId, prev);
  }

  const linesByOrder = new Map<string, Array<Record<string, unknown>>>();
  for (const line of lines) {
    const d = dieMap.get(line.dieId);
    const prod = producedByLine.get(line.id) ?? { weightG: 0, pcs: 0 };
    const disp = dispatchedByLine.get(line.id) ?? { weightG: 0, pcs: 0 };
    const bakiKgG = Math.max(0, line.kgG - disp.weightG);
    const list = linesByOrder.get(line.salesOrderId) ?? [];
    list.push({
      id: line.id,
      lineNo: line.lineNo,
      dieId: line.dieId,
      sectionCode: d?.sectionCode ?? null,
      sectionName: d?.name ?? null,
      series: d?.series ?? null,
      dieInstanceId: line.dieInstanceId ?? null,
      tierRank: line.tierRank ?? null,
      kgPer12ftMilli: line.kgPer12ftMilli ?? null,
      cutLengthMm: line.cutLengthMm,
      pcs: line.pcs ?? null,
      kgG: line.kgG,
      producedKgG: prod.weightG,
      producedPcs: prod.pcs,
      dispatchedKgG: disp.weightG,
      dispatchedPcs: disp.pcs,
      bakiKgG,
      finish: line.finish ?? null,
      qtyBasis: line.qtyBasis ?? null,
      impliedG: line.impliedG ?? null,
      weightBasis: line.weightBasis ?? null,
      bandStartMilli: line.bandStartMilli ?? null,
      copyMilli: line.copyMilli ?? null,
      alloy: line.alloy ?? null,
      temper: line.temper ?? null,
      note: line.note ?? null,
    });
    linesByOrder.set(line.salesOrderId, list);
  }

  const records: EdgeSnapshotRecordItem[] = orders.map((o) => {
    const cust = customerMap.get(o.customerId);
    const orderLines = linesByOrder.get(o.id) ?? [];
    return {
      entityId: o.id,
      sortKey: `${o.orderDate}:${o.number}`,
      dto: {
        id: o.id,
        period: o.period,
        number: o.number,
        customerId: o.customerId,
        customerName: cust?.name ?? null,
        poNumber: o.poNumber ?? null,
        orderDate: o.orderDate,
        expectedDate: o.expectedDate ?? null,
        status: o.status,
        finish: o.finish ?? null,
        source: o.source,
        note: o.note ?? null,
        lines: orderLines,
        createdAt: o.createdAt ? o.createdAt.toISOString() : null,
        updatedAt: o.updatedAt ? o.updatedAt.toISOString() : null,
      },
    };
  });

  return {
    records,
    summaries: [{ kind: "orders_summary", totalOrders: orders.length, totalLines: lines.length }],
  };
}

async function buildDiesSection(db: OrrnDb, companyId: string): Promise<BuiltSectionData> {
  // Explicit projection omitting drawingKey and r2Key
  const [dies, copies, bands, files, customers] = await db.batch([
    db
      .select({
        id: die.id,
        series: die.series,
        sectionCode: die.sectionCode,
        name: die.name,
        legMm: die.legMm,
        widthMm: die.widthMm,
        thicknessMm: die.thicknessMm,
        dimensions: die.dimensions,
        weightMinG: die.weightMinG,
        weightMaxG: die.weightMaxG,
        status: die.status,
        notes: die.notes,
        alloy: die.alloy,
        temper: die.temper,
        profileKind: die.profileKind,
        ownerCustomerId: die.ownerCustomerId,
        cavityCount: die.cavityCount,
        wallTenthMm: die.wallTenthMm,
        createdAt: die.createdAt,
        updatedAt: die.updatedAt,
      })
      .from(die)
      .where(and(eq(die.companyId, companyId), isNull(die.deletedAt)))
      .orderBy(asc(die.sectionCode)),
    db
      .select({
        id: dieInstance.id,
        sectionId: dieInstance.sectionId,
        seqNo: dieInstance.seqNo,
        code: dieInstance.code,
        status: dieInstance.status,
        tierRank: dieInstance.tierRank,
        trialKgPer12ftMilli: dieInstance.trialKgPer12ftMilli,
        hardness: dieInstance.hardness,
        lifeG: dieInstance.lifeG,
        bandId: dieInstance.bandId,
        ownerCustomerId: dieInstance.ownerCustomerId,
        cavityCount: dieInstance.cavityCount,
        rackNo: dieInstance.rackNo,
      })
      .from(dieInstance)
      .where(eq(dieInstance.companyId, companyId))
      .orderBy(asc(dieInstance.seqNo)),
    db
      .select({
        id: dieBand.id,
        sectionId: dieBand.sectionId,
        wallTenthMm: dieBand.wallTenthMm,
        weightMinG: dieBand.weightMinG,
        weightMaxG: dieBand.weightMaxG,
        label: dieBand.label,
        active: dieBand.active,
      })
      .from(dieBand)
      .where(eq(dieBand.companyId, companyId)),
    db
      .select({
        id: dieFile.id,
        sectionId: dieFile.sectionId,
        dieInstanceId: dieFile.dieInstanceId,
        kind: dieFile.kind,
        filename: dieFile.filename,
        bytes: dieFile.bytes,
        pressDrawing: dieFile.pressDrawing,
      })
      .from(dieFile)
      .where(eq(dieFile.companyId, companyId)),
    db
      .select({
        id: customer.id,
        name: customer.name,
      })
      .from(customer)
      .where(eq(customer.companyId, companyId)),
  ]);

  const customerMap = new Map(customers.map((c) => [c.id, c.name]));
  const copiesBySection = new Map<string, Array<Record<string, unknown>>>();
  for (const c of copies) {
    const list = copiesBySection.get(c.sectionId) ?? [];
    list.push({
      id: c.id,
      seqNo: c.seqNo,
      code: c.code,
      status: c.status,
      tierRank: c.tierRank ?? null,
      trialKgPer12ftMilli: c.trialKgPer12ftMilli ?? null,
      hardness: c.hardness ?? null,
      lifeG: c.lifeG ?? null,
      bandId: c.bandId ?? null,
      ownerCustomerId: c.ownerCustomerId ?? null,
      ownerCustomerName: c.ownerCustomerId ? (customerMap.get(c.ownerCustomerId) ?? null) : null,
      cavityCount: c.cavityCount ?? null,
      rackNo: c.rackNo ?? null,
    });
    copiesBySection.set(c.sectionId, list);
  }

  const bandsBySection = new Map<string, Array<Record<string, unknown>>>();
  for (const b of bands) {
    const list = bandsBySection.get(b.sectionId) ?? [];
    list.push({
      id: b.id,
      wallTenthMm: b.wallTenthMm,
      weightMinG: b.weightMinG,
      weightMaxG: b.weightMaxG,
      label: b.label ?? null,
      active: Boolean(b.active),
    });
    bandsBySection.set(b.sectionId, list);
  }

  const filesBySection = new Map<string, Array<Record<string, unknown>>>();
  for (const f of files) {
    const list = filesBySection.get(f.sectionId) ?? [];
    list.push({
      id: f.id,
      dieInstanceId: f.dieInstanceId ?? null,
      kind: f.kind,
      filename: f.filename,
      bytes: f.bytes,
      pressDrawing: Boolean(f.pressDrawing),
    });
    filesBySection.set(f.sectionId, list);
  }

  const records: EdgeSnapshotRecordItem[] = dies.map((d) => ({
    entityId: d.id,
    sortKey: `${d.sectionCode}:${d.series}`,
    dto: {
      id: d.id,
      series: d.series,
      sectionCode: d.sectionCode,
      name: d.name ?? null,
      legMm: d.legMm ?? null,
      widthMm: d.widthMm ?? null,
      thicknessMm: d.thicknessMm ?? null,
      dimensions: d.dimensions ?? {},
      weightMinG: d.weightMinG,
      weightMaxG: d.weightMaxG,
      status: d.status,
      notes: d.notes ?? null,
      alloy: d.alloy ?? null,
      temper: d.temper ?? null,
      profileKind: d.profileKind ?? null,
      ownerCustomerId: d.ownerCustomerId ?? null,
      ownerCustomerName: d.ownerCustomerId ? (customerMap.get(d.ownerCustomerId) ?? null) : null,
      cavityCount: d.cavityCount ?? null,
      wallTenthMm: d.wallTenthMm ?? null,
      copies: copiesBySection.get(d.id) ?? [],
      bands: bandsBySection.get(d.id) ?? [],
      files: filesBySection.get(d.id) ?? [],
      createdAt: d.createdAt ? d.createdAt.toISOString() : null,
      updatedAt: d.updatedAt ? d.updatedAt.toISOString() : null,
    },
  }));

  return {
    records,
    summaries: [{ kind: "dies_summary", totalSections: dies.length, totalCopies: copies.length }],
  };
}

async function buildPrintStatusSection(db: OrrnDb, companyId: string): Promise<BuiltSectionData> {
  // Explicit projection omitting variables and spoolJobId
  const [logs, profiles, bundles] = await db.batch([
    db
      .select({
        id: printLog.id,
        bundleId: printLog.bundleId,
        templateId: printLog.templateId,
        profileId: printLog.profileId,
        deploymentId: printLog.deploymentId,
        status: printLog.status,
        copies: printLog.copies,
        layout: printLog.layout,
        responseText: printLog.responseText,
        attempt: printLog.attempt,
        labelVersion: printLog.labelVersion,
        jobKey: printLog.jobKey,
        createdAt: printLog.createdAt,
        updatedAt: printLog.updatedAt,
      })
      .from(printLog)
      .where(eq(printLog.companyId, companyId))
      .orderBy(desc(printLog.createdAt))
      .limit(500),
    db
      .select({
        id: printerProfile.id,
        name: printerProfile.name,
        deploymentId: printerProfile.deploymentId,
      })
      .from(printerProfile)
      .where(eq(printerProfile.companyId, companyId)),
    db
      .select({
        id: bundle.id,
        serial: bundle.serial,
      })
      .from(bundle)
      .where(eq(bundle.companyId, companyId)),
  ]);

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const bundleSerialMap = new Map(bundles.map((b) => [b.id, b.serial]));

  const records: EdgeSnapshotRecordItem[] = logs.map((l) => {
    const prof = profileMap.get(l.profileId);
    const serial = l.bundleId ? (bundleSerialMap.get(l.bundleId) ?? null) : null;
    return {
      entityId: l.id,
      sortKey: `${l.createdAt ? l.createdAt.toISOString() : ""}:${l.id}`,
      dto: {
        id: l.id,
        bundleId: l.bundleId ?? null,
        bundleSerial: serial,
        profileId: l.profileId,
        profileName: prof?.name ?? null,
        deploymentId: l.deploymentId ?? prof?.deploymentId ?? null,
        status: l.status,
        copies: l.copies ?? 1,
        layout: l.layout ?? "x0",
        responseText: l.responseText ?? null,
        attempt: l.attempt,
        labelVersion: l.labelVersion ?? 1,
        jobKey: l.jobKey ?? null,
        createdAt: l.createdAt ? l.createdAt.toISOString() : null,
        updatedAt: l.updatedAt ? l.updatedAt.toISOString() : null,
      },
    };
  });

  return {
    records,
    summaries: [{ kind: "print_status_summary", totalJobs: logs.length }],
  };
}

function sanitizeCompanySettings(settings: Record<string, unknown>): Record<string, unknown> {
  const allowedKeys = ["timezone", "units", "standards", "orderToleranceBp", "bundleNumberStyle", "dieRoom"];
  const out: Record<string, unknown> = {};
  for (const k of allowedKeys) {
    if (k in settings) {
      out[k] = settings[k];
    }
  }
  return out;
}

async function buildCompanyFormatSection(db: OrrnDb, companyId: string): Promise<BuiltSectionData> {
  const [compRows] = await db.batch([
    db
      .select({
        id: company.id,
        name: company.name,
        slug: company.slug,
        settings: company.settings,
      })
      .from(company)
      .where(eq(company.id, companyId))
      .limit(1),
  ]);

  const comp = compRows[0];
  const safeSettings = sanitizeCompanySettings((comp?.settings ?? {}) as Record<string, unknown>);
  const records: EdgeSnapshotRecordItem[] = comp
    ? [
        {
          entityId: comp.id,
          sortKey: comp.slug,
          dto: {
            id: comp.id,
            name: comp.name,
            slug: comp.slug,
            timezone: (safeSettings.timezone as string) ?? "Asia/Kolkata",
            units: safeSettings.units ?? { weight: "kg", length: "ft" },
            settings: safeSettings,
          },
        },
      ]
    : [];

  return {
    records,
    summaries: [{ kind: "company_format_summary", companyName: comp?.name ?? "" }],
  };
}

async function buildSectionData(
  db: OrrnDb,
  companyId: string,
  section: EdgeSnapshotSection,
): Promise<BuiltSectionData> {
  switch (section) {
    case "stock":
      return buildStockSection(db, companyId);
    case "orders":
      return buildOrdersSection(db, companyId);
    case "dies":
      return buildDiesSection(db, companyId);
    case "print_status":
      return buildPrintStatusSection(db, companyId);
    case "company_format":
      return buildCompanyFormatSection(db, companyId);
  }
}

function chunkSectionRecords(
  records: EdgeSnapshotRecordItem[],
  summaries: Array<Record<string, unknown>>,
): Array<{ records: EdgeSnapshotRecordItem[]; summaries: Array<Record<string, unknown>> }> {
  if (records.length === 0) {
    return [{ records: [], summaries }];
  }

  const chunks: Array<{ records: EdgeSnapshotRecordItem[]; summaries: Array<Record<string, unknown>> }> = [];
  let currentRecords: EdgeSnapshotRecordItem[] = [];
  let currentBytes = 1024;
  const encoder = new TextEncoder();

  for (const rec of records) {
    const recBytes = encoder.encode(JSON.stringify(rec)).byteLength + 2;
    if (currentRecords.length > 0 && currentBytes + recBytes > EDGE_SNAPSHOT_MAX_CHUNK_BYTES) {
      chunks.push({
        records: currentRecords,
        summaries: chunks.length === 0 ? summaries : [],
      });
      currentRecords = [];
      currentBytes = 1024;
    }
    currentRecords.push(rec);
    currentBytes += recBytes;
  }

  if (currentRecords.length > 0) {
    chunks.push({
      records: currentRecords,
      summaries: chunks.length === 0 ? summaries : [],
    });
  }

  return chunks;
}

async function pruneOldSnapshotsForSection(
  db: OrrnDb,
  companyId: string,
  section: EdgeSnapshotSection,
  nowMs: number,
  retainLatestCount = 2,
): Promise<void> {
  const completed = await db
    .select({
      id: edgeSnapshot.id,
      generatedAt: edgeSnapshot.generatedAt,
    })
    .from(edgeSnapshot)
    .where(
      and(
        eq(edgeSnapshot.companyId, companyId),
        eq(edgeSnapshot.section, section),
        eq(edgeSnapshot.complete, true),
      ),
    )
    .orderBy(desc(edgeSnapshot.generatedAt), desc(edgeSnapshot.id))
    .all();

  if (completed.length <= retainLatestCount) return;

  const keepIds = new Set(completed.slice(0, retainLatestCount).map((r) => r.id));
  const cutoff = new Date(nowMs - EDGE_SNAPSHOT_MIN_RETENTION_MS);

  await db
    .delete(edgeSnapshot)
    .where(
      and(
        eq(edgeSnapshot.companyId, companyId),
        eq(edgeSnapshot.section, section),
        notInArray(edgeSnapshot.id, [...keepIds]),
        lte(edgeSnapshot.generatedAt, cutoff),
      ),
    );
}

/**
 * Builds or returns the cached company snapshot manifest across all 5 sections.
 * Caches complete snapshots for 60s unless `forceRebuild: true`.
 */
export async function buildOrGetCompanySnapshotManifest(
  db: OrrnDb,
  input: {
    companyId: string;
    forceRebuild?: boolean;
    nowMs?: number;
  },
): Promise<EdgeSnapshotManifest> {
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const descriptors: EdgeSnapshotSectionDescriptor[] = [];

  for (const section of edgeSnapshotSections) {
    if (!input.forceRebuild) {
      const latest = await db
        .select()
        .from(edgeSnapshot)
        .where(
          and(
            eq(edgeSnapshot.companyId, input.companyId),
            eq(edgeSnapshot.section, section),
            eq(edgeSnapshot.complete, true),
          ),
        )
        .orderBy(desc(edgeSnapshot.generatedAt), desc(edgeSnapshot.id))
        .limit(1)
        .get();

      if (latest && nowMs - latest.generatedAt.getTime() < EDGE_SNAPSHOT_CACHE_TTL_MS) {
        const chunks = await db
          .select({
            sequence: edgeSnapshotChunk.sequence,
            sha256: edgeSnapshotChunk.sha256,
            recordCount: edgeSnapshotChunk.recordCount,
            byteLength: edgeSnapshotChunk.byteLength,
          })
          .from(edgeSnapshotChunk)
          .where(eq(edgeSnapshotChunk.snapshotId, latest.id))
          .orderBy(asc(edgeSnapshotChunk.sequence))
          .all();

        if (chunks.length === latest.chunkCount && chunks.length > 0) {
          descriptors.push({
            section,
            snapshotId: latest.id,
            generatedAt: latest.generatedAt.toISOString(),
            contentSha256: latest.contentSha256,
            recordCount: latest.recordCount,
            chunkCount: latest.chunkCount,
            complete: true,
            chunks,
          });
          continue;
        }
      }
    }

    const built = await buildSectionData(db, input.companyId, section);
    const snapshotId = crypto.randomUUID();
    const rawChunks = chunkSectionRecords(built.records, built.summaries);
    const encoder = new TextEncoder();
    const encodedChunks: Array<{ payload: EdgeSnapshotChunkPayload; payloadJson: string; byteLength: number }> = [];

    for (let seq = 0; seq < rawChunks.length; seq += 1) {
      const part = rawChunks[seq]!;
      const unsignedPayload: Omit<EdgeSnapshotChunkPayload, "sha256"> = {
        protocolVersion: 1,
        cacheSchemaVersion: 1,
        companyId: input.companyId,
        section,
        snapshotId,
        sequence: seq,
        recordCount: part.records.length,
        records: part.records,
        summaries: part.summaries,
      };
      const chunkSha = await sha256Hex(canonicalizeEdgeSnapshotDocument(unsignedPayload));
      const payload: EdgeSnapshotChunkPayload = { ...unsignedPayload, sha256: chunkSha };
      const payloadJson = JSON.stringify(payload);
      encodedChunks.push({ payload, payloadJson, byteLength: encoder.encode(payloadJson).byteLength });
    }

    // Section integrity covers the ordered, complete chunk documents. Each document
    // omits only its own top-level sha256, so neither hash is self-referential.
    const contentSha256 = await sha256Hex(
      canonicalizeEdgeSnapshotDocument(encodedChunks.map(({ payload }) => edgeSnapshotUnsignedChunkDocument(payload))),
    );
    await db.insert(edgeSnapshot).values({
      id: snapshotId,
      companyId: input.companyId,
      section,
      schemaVersion: 1,
      contentSha256,
      recordCount: built.records.length,
      chunkCount: rawChunks.length,
      complete: false,
      generatedAt: now,
    });

    const chunkDescriptors: EdgeSnapshotSectionDescriptor["chunks"] = [];
    for (const { payload, payloadJson, byteLength } of encodedChunks) {
      await db.insert(edgeSnapshotChunk).values({
        id: crypto.randomUUID(),
        snapshotId,
        companyId: input.companyId,
        section,
        sequence: payload.sequence,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        byteLength,
        payloadJson,
        createdAt: now,
      });
      chunkDescriptors.push({
        sequence: payload.sequence,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        byteLength,
      });
    }

    await db
      .update(edgeSnapshot)
      .set({ complete: true })
      .where(eq(edgeSnapshot.id, snapshotId));

    await pruneOldSnapshotsForSection(db, input.companyId, section, nowMs);

    descriptors.push({
      section,
      snapshotId,
      generatedAt: now.toISOString(),
      contentSha256,
      recordCount: built.records.length,
      chunkCount: rawChunks.length,
      complete: true,
      chunks: chunkDescriptors,
    });
  }

  return {
    protocolVersion: 1,
    cacheSchemaVersion: 1,
    companyId: input.companyId,
    minAgentVersion: EDGE_SNAPSHOT_MIN_AGENT_VERSION,
    generatedAt: now.toISOString(),
    sections: descriptors,
  };
}

/**
 * Retrieves a single snapshot chunk for an authenticated node, verifying company ownership.
 */
export async function getSnapshotChunkForNode(
  db: OrrnDb,
  input: {
    companyId: string;
    snapshotId: string;
    sequence: number;
  },
): Promise<
  | { ok: true; status: 200; body: EdgeSnapshotChunkPayload }
  | { ok: false; status: 403 | 404; body: { code: string; error: string } }
> {
  const snap = await db
    .select()
    .from(edgeSnapshot)
    .where(eq(edgeSnapshot.id, input.snapshotId))
    .get();

  if (!snap || !snap.complete) {
    return {
      ok: false,
      status: 404,
      body: { code: "snapshot_not_found", error: "Snapshot not found or incomplete" },
    };
  }

  if (snap.companyId !== input.companyId) {
    return {
      ok: false,
      status: 403,
      body: { code: "cross_company_denied", error: "Snapshot does not belong to this node's company" },
    };
  }

  const chunk = await db
    .select()
    .from(edgeSnapshotChunk)
    .where(
      and(
        eq(edgeSnapshotChunk.snapshotId, input.snapshotId),
        eq(edgeSnapshotChunk.companyId, input.companyId),
        eq(edgeSnapshotChunk.sequence, input.sequence),
      ),
    )
    .get();

  if (!chunk) {
    return {
      ok: false,
      status: 404,
      body: { code: "chunk_not_found", error: "Snapshot chunk not found" },
    };
  }

  const parsed = JSON.parse(chunk.payloadJson) as EdgeSnapshotChunkPayload;
  return {
    ok: true,
    status: 200,
    body: parsed,
  };
}
