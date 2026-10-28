import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { dieFile } from "@orrn/db/schema/dies";
import { bundle } from "@orrn/db/schema/inventory";
import { labelTemplate, printerProfile, printLog } from "@orrn/db/schema/printing";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";

import {
  buildOrGetCompanySnapshotManifest,
  canonicalizeEdgeSnapshotDocument,
  edgeSnapshotUnsignedChunkDocument,
  getSnapshotChunkForNode,
} from "../src/lib/edge-snapshots";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

describe("edge v1 sanitized snapshots", () => {
  test("builds all five sections, strips prices and label variables, and reflects hard deletes on next generation", async () => {
    const { companyId } = await env.seedCompany();
    const other = await env.seedCompany();
    const dieId = await env.seedDie(companyId, { drawingKey: "secret-r2-drawing-key" });
    const customerId = await env.seedCustomer(companyId);
    const [bundleRow] = await env.seedBundles(companyId, dieId, 1);

    await env.db.insert(dieFile).values({
      id: crypto.randomUUID(),
      companyId,
      sectionId: dieId,
      kind: "pdf",
      r2Key: "secret-r2-object-key-123",
      filename: "drawing.pdf",
      bytes: 12345,
      pressDrawing: true,
    });

    const orderId = crypto.randomUUID();
    await env.db.insert(salesOrder).values({
      id: orderId,
      companyId,
      period: "2026-27",
      number: "SO-1",
      customerId,
      orderDate: "2026-10-26",
      status: "confirmed",
    });

    await env.db.insert(salesOrderLine).values({
      id: crypto.randomUUID(),
      companyId,
      salesOrderId: orderId,
      lineNo: 1,
      dieId,
      cutLengthMm: 3658,
      pcs: 100,
      kgG: 250000,
      ratePaise: 24500, // Sensitive rate field that MUST be stripped
    });

    const templateId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    await env.db.insert(labelTemplate).values({
      id: templateId,
      companyId,
      name: "Bundle Label",
      kind: "bundle",
      schema: {},
    });
    await env.db.insert(printerProfile).values({
      id: profileId,
      companyId,
      name: "Packing Printer",
      spoolPrinterId: "tsc-1",
      templateId,
    });
    await env.db.insert(printLog).values({
      id: crypto.randomUUID(),
      companyId,
      bundleId: bundleRow!.id,
      templateId,
      profileId,
      status: "sent",
      variables: { secretPartyCode: "CONFIDENTIAL-LABEL-VAR" },
    });

    const manifest = await buildOrGetCompanySnapshotManifest(env.db, {
      companyId,
      forceRebuild: true,
      nowMs: 1_700_000_000_000,
    });

    expect(manifest.sections.map((s) => s.section)).toEqual([
      "stock",
      "orders",
      "dies",
      "print_status",
      "company_format",
    ]);

    for (const sec of manifest.sections) {
      expect(sec.complete).toBe(true);
      const chunk = await getSnapshotChunkForNode(env.db, {
        companyId,
        snapshotId: sec.snapshotId,
        sequence: 0,
      });
      expect(chunk.ok).toBe(true);
      if (!chunk.ok) continue;
      const raw = JSON.stringify(chunk.body);
      expect(raw).not.toContain("ratePaise");
      expect(raw).not.toContain("24500");
      expect(raw).not.toContain("sharedSecret");
      expect(raw).not.toContain("cfTunnelToken");
      expect(raw).not.toContain("CONFIDENTIAL-LABEL-VAR");
      expect(raw).not.toContain("secret-r2-drawing-key");
      expect(raw).not.toContain("secret-r2-object-key-123");

      // Cross-company access to this chunk is denied
      const crossCompany = await getSnapshotChunkForNode(env.db, {
        companyId: other.companyId,
        snapshotId: sec.snapshotId,
        sequence: 0,
      });
      expect(crossCompany.ok).toBe(false);
      if (!crossCompany.ok) {
        expect(crossCompany.status).toBe(403);
      }
    }

    // Within 60s without forceRebuild, cached manifest returns the same snapshotIds
    const cachedManifest = await buildOrGetCompanySnapshotManifest(env.db, {
      companyId,
      forceRebuild: false,
      nowMs: 1_700_000_030_000,
    });
    expect(cachedManifest.sections.map((s) => s.snapshotId)).toEqual(
      manifest.sections.map((s) => s.snapshotId),
    );

    // Hard delete of bundle is reflected on the next rebuilt snapshot generation
    await env.db.delete(bundle).where(eq(bundle.id, bundleRow!.id));
    const manifestAfterDelete = await buildOrGetCompanySnapshotManifest(env.db, {
      companyId,
      forceRebuild: true,
      nowMs: 1_700_000_070_000,
    });
    const stockSection = manifestAfterDelete.sections.find((s) => s.section === "stock")!;
    expect(stockSection.recordCount).toBe(0);
  });

  test("hashes the complete canonical wire documents without digest self-reference", async () => {
    const { companyId } = await env.seedCompany();
    const manifest = await buildOrGetCompanySnapshotManifest(env.db, { companyId, forceRebuild: true });
    const digest = async (value: unknown) => {
      const bytes = new TextEncoder().encode(canonicalizeEdgeSnapshotDocument(value));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    };

    for (const section of manifest.sections) {
      const unsignedChunks = [];
      for (const descriptor of section.chunks) {
        const result = await getSnapshotChunkForNode(env.db, {
          companyId,
          snapshotId: section.snapshotId,
          sequence: descriptor.sequence,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const unsigned = edgeSnapshotUnsignedChunkDocument(result.body);
        unsignedChunks.push(unsigned);
        expect(result.body.sha256).toBe(await digest(unsigned));
        expect(result.body.sha256).toBe(descriptor.sha256);
        expect(await digest({ ...unsigned, companyId: crypto.randomUUID() })).not.toBe(result.body.sha256);
      }
      expect(section.contentSha256).toBe(await digest(unsignedChunks));
    }
  });

  test("matches the fixed Go snapshot digest vector", async () => {
    const unsigned = {
      protocolVersion: 1,
      cacheSchemaVersion: 1,
      companyId: "comp-1",
      section: "stock",
      snapshotId: "snap-fixed",
      sequence: 0,
      recordCount: 1,
      records: [{ entityId: "b-1", sortKey: "001", dto: { serial: "26I4086", html: "<b>&</b>", quantity: 1.2 } }],
      summaries: [],
    };
    const digest = async (value: unknown) => {
      const bytes = new TextEncoder().encode(canonicalizeEdgeSnapshotDocument(value));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    expect(await digest(unsigned)).toBe("c0f04cab73f8d6e75aa331f774a02e7274a7dacb7b1199905879daf45f384c43");
    expect(await digest([unsigned])).toBe("7f19b0f63e40ebdd2bf0fb99ea7beba16fad3722cf5e6863a10c3772bc57f6d9");
  });
});
