import {
  defaultEdgeCapabilities,
  edgeNodeEnrollmentInputSchema,
  edgeNodeStatuses,
  type EdgeCapability,
} from "@orrn/edge-runtime";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, isNotNull, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";

import type { OrrnDb } from "@orrn/db";
import { edgeNodeDeployment } from "@orrn/db/schema/spool";
import { company } from "@orrn/db/schema/tenant";
import { env } from "@orrn/env/server";

import { deleteDnsRecord, deleteTunnel, findDnsRecord } from "../lib/cloudflare";
import { createEdgeEnrollmentNode } from "../lib/edge-v1";
import { actionProcedure, companyProcedure, router } from "../index";

/** Live (not revoked) edge nodes a plant may hold, any kind, Godseye's included (security review 2026-11-04). */
export const MAX_EDGE_NODES_PER_COMPANY = 5;

/** Where the node exchanges its one-time enrolment code for its node secret (apps/server/src/edge-v1-routes.ts). */
const EDGE_ENROLL_EXCHANGE_PATH = "/api/edge/v1/enroll";

type EdgeNodeSummary = {
  id: string;
  companyId: string;
  instanceId: string;
  nodeName: string;
  siteLabel: string;
  status: (typeof edgeNodeStatuses)[number];
  subdomain: string;
  nodeDomain: string;
  runtimeFlavor: string;
  runtimePlatform: string | null;
  runtimeVersion: string | null;
  capabilities: EdgeCapability[];
  fingerprint: string | null;
  lastHeartbeatAt: Date | null;
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const edgeManageProcedure = actionProcedure("edge.manage");
const edgeRevokeSchema = z.object({ id: z.string().uuid() });

export const edgeRouter = router({
  overview: companyProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: edgeNodeDeployment.id,
        companyId: edgeNodeDeployment.companyId,
        instanceId: edgeNodeDeployment.instanceId,
        nodeName: edgeNodeDeployment.nodeName,
        siteLabel: edgeNodeDeployment.siteLabel,
        status: edgeNodeDeployment.status,
        subdomain: edgeNodeDeployment.subdomain,
        nodeDomain: edgeNodeDeployment.nodeDomain,
        runtimeFlavor: edgeNodeDeployment.runtimeFlavor,
        runtimePlatform: edgeNodeDeployment.runtimePlatform,
        runtimeVersion: edgeNodeDeployment.runtimeVersion,
        capabilities: edgeNodeDeployment.capabilities,
        fingerprint: edgeNodeDeployment.fingerprint,
        lastHeartbeatAt: edgeNodeDeployment.lastHeartbeatAt,
        lastSyncAt: edgeNodeDeployment.lastSyncAt,
        lastErrorCode: edgeNodeDeployment.lastErrorCode,
        lastErrorMessage: edgeNodeDeployment.lastErrorMessage,
        scaleConfigured: edgeNodeDeployment.scaleConfigured,
        scaleSimulated: edgeNodeDeployment.scaleSimulated,
        scaleLastFrameAt: edgeNodeDeployment.scaleLastFrameAt,
        scaleReportedAt: edgeNodeDeployment.scaleReportedAt,
        collectors: edgeNodeDeployment.collectors,
        collectorsReportedAt: edgeNodeDeployment.collectorsReportedAt,
        createdAt: edgeNodeDeployment.createdAt,
        updatedAt: edgeNodeDeployment.updatedAt,
      })
      .from(edgeNodeDeployment)
      .where(eq(edgeNodeDeployment.companyId, ctx.companyId))
      .orderBy(desc(edgeNodeDeployment.createdAt));

    return {
      current: rows[0] ?? null,
      nodes: rows,
      defaultCapabilities: defaultEdgeCapabilities,
    };
  }),

  /**
   * Security review 2026-11-04 (CRITICAL 1). A tenant enrolment makes an outbound-only ORRN Edge
   * node: no Cloudflare Tunnel, no DNS record, and no secret in the answer. The caller gets a
   * 15-minute single-use enrolment code that the node exchanges at POST /api/edge/v1/enroll for its
   * node secret (lib/edge-v1.ts). The node's address is ORRN's to choose (`input.subdomain` is
   * ignored), and a plant holds at most MAX_EDGE_NODES_PER_COMPANY live nodes.
   */
  enroll: edgeManageProcedure.input(edgeNodeEnrollmentInputSchema).mutation(async ({ ctx, input }) => {
    const targetCompany = await ctx.db
      .select({ id: company.id, name: company.name, status: company.status })
      .from(company)
      .where(eq(company.id, ctx.companyId))
      .get();

    if (!targetCompany) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
    }
    if (targetCompany.status !== "active") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Company must be active to enroll an edge node" });
    }

    if ((await liveNodeCount(ctx.db, ctx.companyId)) >= MAX_EDGE_NODES_PER_COMPANY) throw nodeCapError();

    const capabilities = dedupeCapabilities(input.capabilities);
    const created = await createEdgeEnrollmentNode(ctx.db, {
      companyId: ctx.companyId,
      nodeName: input.nodeName,
      siteLabel: input.siteLabel,
      masterKey: env.ORRN_MASTER_KEY,
      runtimeFlavor: input.runtimeFlavor,
      runtimePlatform: input.runtimePlatform ?? null,
      capabilities,
      fingerprint: input.fingerprint ?? null,
    });

    // Two enrolments at once can both pass the check above. Each counts again after its own insert
    // and takes its row back when the plant is over the cap, so the cap always holds. A code that
    // expired unused does not count (liveNodeCount).
    if ((await liveNodeCount(ctx.db, ctx.companyId)) > MAX_EDGE_NODES_PER_COMPANY) {
      await ctx.db
        .delete(edgeNodeDeployment)
        .where(and(eq(edgeNodeDeployment.id, created.deploymentId), eq(edgeNodeDeployment.companyId, ctx.companyId)));
      throw nodeCapError();
    }

    const now = new Date();
    const deployment: EdgeNodeSummary = {
      id: created.deploymentId,
      companyId: ctx.companyId,
      instanceId: created.instanceId,
      nodeName: input.nodeName,
      siteLabel: input.siteLabel,
      status: "pending",
      subdomain: created.subdomain,
      nodeDomain: created.nodeDomain,
      runtimeFlavor: input.runtimeFlavor,
      runtimePlatform: input.runtimePlatform ?? null,
      runtimeVersion: null,
      capabilities,
      fingerprint: input.fingerprint ?? null,
      lastHeartbeatAt: null,
      lastSyncAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    return {
      deployment,
      enrollment: {
        enrollmentToken: created.enrollmentToken,
        enrollmentExpiresAt: created.enrollmentExpiresAt,
        exchangePath: EDGE_ENROLL_EXCHANGE_PATH,
        orrnServerUrl: env.BETTER_AUTH_URL,
      },
    };
  }),

  revoke: edgeManageProcedure.input(edgeRevokeSchema).mutation(async ({ ctx, input }) => {
    const row = await ctx.db
      .select()
      .from(edgeNodeDeployment)
      .where(and(eq(edgeNodeDeployment.id, input.id), eq(edgeNodeDeployment.companyId, ctx.companyId)))
      .get();

    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Edge node not found" });
    }
    if (row.status === "revoked") {
      return { success: true };
    }

    if (row.cfTunnelId) {
      const dnsRecordId = await findDnsRecord(row.subdomain);
      if (dnsRecordId) {
        try {
          await deleteDnsRecord(dnsRecordId);
        } catch {
          // Best effort cleanup.
        }
      }
      try {
        await deleteTunnel(row.cfTunnelId);
      } catch {
        // Best effort cleanup.
      }
    }

    await ctx.db
      .update(edgeNodeDeployment)
      .set({ status: "revoked", lastErrorCode: null, lastErrorMessage: null })
      .where(eq(edgeNodeDeployment.id, row.id));

    return { success: true };
  }),
});

/**
 * Nodes that hold one of the plant's places: every row that is not revoked, except an enrolment that
 * was never finished and whose code has expired (still `pending`, code unused, no installation, expiry
 * past). Nobody can enrol with such a code, so it must not lock a plant out after a few abandoned tries
 * (review fix 2026-11-05). A row with no code at all (made before Edge V1) still counts. Godseye can
 * issue a fresh code for an expired row (`platform.edgeNodeIssueEnrollmentToken`); its own actions are
 * not capped.
 */
async function liveNodeCount(db: OrrnDb, companyId: string): Promise<number> {
  const row = await db
    .select({ n: count() })
    .from(edgeNodeDeployment)
    .where(
      and(
        eq(edgeNodeDeployment.companyId, companyId),
        ne(edgeNodeDeployment.status, "revoked"),
        or(
          ne(edgeNodeDeployment.status, "pending"),
          isNotNull(edgeNodeDeployment.enrollmentUsedAt),
          isNotNull(edgeNodeDeployment.installId),
          isNull(edgeNodeDeployment.enrollmentExpiresAt),
          gte(edgeNodeDeployment.enrollmentExpiresAt, new Date()),
        ),
      ),
    )
    .get();
  return row?.n ?? 0;
}

function nodeCapError() {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: `This plant already has ${MAX_EDGE_NODES_PER_COMPANY} print computers. Remove one before adding another.`,
  });
}

function dedupeCapabilities(capabilities: readonly EdgeCapability[]) {
  return Array.from(new Set(capabilities));
}
