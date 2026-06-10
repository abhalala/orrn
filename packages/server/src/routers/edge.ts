import {
  defaultEdgeCapabilities,
  edgeNodeEnrollmentInputSchema,
  edgeNodeStatuses,
  type EdgeCapability,
} from "@orrn/edge-runtime";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { OrrnDb } from "@orrn/db";
import { edgeNodeDeployment } from "@orrn/db/schema/spool";
import { company } from "@orrn/db/schema/tenant";
import { wrapSecret } from "@orrn/crypto";
import { env } from "@orrn/env/server";

import { createCnameRecord, createTunnel, deleteDnsRecord, deleteTunnel, findDnsRecord } from "../lib/cloudflare";
import { companyProcedure, roleGuard, router } from "../index";

const EDGE_DOMAIN_SUFFIX = ".spool.orrn.in";

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

const edgeManageProcedure = roleGuard("owner", "admin", "manager");
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

    const subdomain = input.subdomain ?? (await buildUniqueSubdomain(ctx.db, targetCompany.name, input.nodeName));
    const existing = await ctx.db
      .select({ id: edgeNodeDeployment.id })
      .from(edgeNodeDeployment)
      .where(eq(edgeNodeDeployment.subdomain, subdomain))
      .get();
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "Subdomain already in use" });
    }

    const sharedSecret = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const sharedSecretHash = await hashSha256(sharedSecret);
    const sharedSecretWrapped = await wrapSecret(sharedSecret, env.ORRN_MASTER_KEY);
    const instanceId = crypto.randomUUID();
    const tunnelName = `edge-${subdomain}`;

    let cfTunnelId: string;
    let cfTunnelToken: string;
    try {
      const tunnel = await createTunnel(tunnelName);
      cfTunnelId = tunnel.id;
      cfTunnelToken = tunnel.token;
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to create Cloudflare Tunnel: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      await createCnameRecord(subdomain, cfTunnelId);
    } catch (error) {
      try {
        await deleteTunnel(cfTunnelId);
      } catch {
        // Best effort rollback.
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to create DNS record: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const cfTunnelTokenWrapped = await wrapSecret(cfTunnelToken, env.ORRN_MASTER_KEY);
    const nodeDomain = `${subdomain}${EDGE_DOMAIN_SUFFIX}`;
    const deploymentId = crypto.randomUUID();
    const capabilities = dedupeCapabilities(input.capabilities);
    const now = new Date();

    await ctx.db.insert(edgeNodeDeployment).values({
      id: deploymentId,
      companyId: ctx.companyId,
      instanceId,
      status: "pending",
      nodeName: input.nodeName,
      siteLabel: input.siteLabel,
      subdomain,
      nodeDomain,
      cfTunnelId,
      cfTunnelTokenWrapped,
      sharedSecretHash,
      sharedSecretWrapped,
      runtimeFlavor: input.runtimeFlavor,
      runtimePlatform: input.runtimePlatform ?? null,
      capabilities,
      fingerprint: input.fingerprint ?? null,
    });

    const deployment: EdgeNodeSummary = {
      id: deploymentId,
      companyId: ctx.companyId,
      instanceId,
      nodeName: input.nodeName,
      siteLabel: input.siteLabel,
      status: "pending",
      subdomain,
      nodeDomain,
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
      config: {
        deploymentId,
        instanceId,
        companyId: ctx.companyId,
        nodeName: input.nodeName,
        siteLabel: input.siteLabel,
        subdomain,
        nodeDomain,
        runtimeFlavor: input.runtimeFlavor,
        runtimePlatform: input.runtimePlatform ?? null,
        sharedSecret,
        cfTunnelToken,
        orrnServerUrl: env.BETTER_AUTH_URL,
        capabilities,
        runtimeVersion: null,
        heartbeatPath: "/webhooks/edge/heartbeat",
        webhookPath: "/webhooks/edge/print-events",
        updateCheckPath: "/api/edge/update-check",
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

async function hashSha256(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function buildUniqueSubdomain(db: OrrnDb, companyName: string, nodeName: string) {
  const companyPart = slugify(companyName) || "orrn";
  const nodePart = slugify(nodeName) || "edge";
  const base = `${companyPart}-${nodePart}`.slice(0, 63);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    const existing = await db
      .select({ id: edgeNodeDeployment.id })
      .from(edgeNodeDeployment)
      .where(eq(edgeNodeDeployment.subdomain, candidate))
      .get();
    if (!existing) {
      return candidate;
    }
  }

  return `${base.slice(0, 54)}-${crypto.randomUUID().slice(0, 8)}`;
}

function dedupeCapabilities(capabilities: readonly EdgeCapability[]) {
  return Array.from(new Set(capabilities));
}
