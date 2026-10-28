import { TRPCError } from "@trpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { spoolDeployment, spoolDeploymentStatuses } from "@orrn/db/schema/spool";
import { company } from "@orrn/db/schema/tenant";
import { unwrapSecret, wrapSecret } from "@orrn/crypto";
import { env } from "@orrn/env/server";

import { createCnameRecord, createTunnel, deleteDnsRecord, deleteTunnel, findDnsRecord } from "../../lib/cloudflare";
import { canRunDevSeed } from "../../lib/devSeedGate";
import { buildDockerInstallScript } from "../../lib/spool-install-script";
import { signDownloadToken } from "../../lib/spool-crypto";
import { getDeliverableFilename } from "../../lib/spool-packager";
import { resolveSpoolReleaseTag } from "../../lib/spool-release";
import { resolveEdgeReleaseArtifact } from "../../lib/edge-release";
import {
  createEdgeEnrollmentNode,
  issueEdgeEnrollmentToken,
  setEdgeNodePrinters,
  stageEdgeSecretRotation,
} from "../../lib/edge-v1";
import { edgeDesiredPrintersSchema, releaseSemverSchema } from "@orrn/edge-runtime";
import { platformGuard } from "../../index";

const SPOOL_DOMAIN_SUFFIX = ".spool.orrn.in";

/** Tunnel ids made by the local-stack stub; never sent to Cloudflare. */
const LOCAL_TUNNEL_PREFIX = "local-";

/**
 * The local worker (wrangler.local.jsonc: NODE_ENV=development, the
 * ORRN_LOCAL_PASSWORD binding, a loopback request host) with no Cloudflare
 * token gets a stub tunnel, so Godseye's Printing tab can be built and
 * tested on a laptop. Same gate as POST /dev/seed; deployed stages always
 * provision a real tunnel.
 */
function useLocalTunnelStub(requestUrl: string): boolean {
  const vars = env as unknown as { NODE_ENV?: string; ORRN_LOCAL_PASSWORD?: string; CF_API_TOKEN?: string };
  return canRunDevSeed(vars, requestUrl) && !(vars.CF_API_TOKEN ?? "").trim();
}

export const spoolProcedures = {
  /** List all spool deployments (paginated, filterable by company/status). */
  spoolDeploymentsList: platformGuard("platform.spool.manage")
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        companyId: z.string().optional(),
        status: z.enum(spoolDeploymentStatuses).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [];
      if (input.companyId) filters.push(eq(spoolDeployment.companyId, input.companyId));
      if (input.status) filters.push(eq(spoolDeployment.status, input.status));
      const whereClause = filters.length ? and(...filters) : undefined;

      const [totalRow] = await ctx.db
        .select({ count: count() })
        .from(spoolDeployment)
        .where(whereClause);

      const rows = await ctx.db
        .select({
          id: spoolDeployment.id,
          companyId: spoolDeployment.companyId,
          instanceId: spoolDeployment.instanceId,
          status: spoolDeployment.status,
          subdomain: spoolDeployment.subdomain,
          spoolDomain: spoolDeployment.nodeDomain,
          spoolVersion: spoolDeployment.runtimeVersion,
          lastSeenAt: spoolDeployment.lastHeartbeatAt,
          installId: spoolDeployment.installId,
          enrollmentIssuedAt: spoolDeployment.enrollmentIssuedAt,
          createdAt: spoolDeployment.createdAt,
          updatedAt: spoolDeployment.updatedAt,
          companyName: company.name,
        })
        .from(spoolDeployment)
        .innerJoin(company, eq(company.id, spoolDeployment.companyId))
        .where(whereClause)
        .orderBy(desc(spoolDeployment.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        items: rows,
        total: totalRow?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /** Create a new spool deployment for a company. */
  spoolDeploymentCreate: platformGuard("platform.spool.manage")
    .input(
      z.object({
        // Company ids are not all UUIDs (createId, the demo company), so any id; the lookup below decides.
        companyId: z.string().min(1).max(64),
        subdomain: z
          .string()
          .min(3)
          .max(63)
          .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Subdomain must be a valid DNS label"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify company exists and is active
      const targetCompany = await ctx.db
        .select({ id: company.id, name: company.name, status: company.status })
        .from(company)
        .where(eq(company.id, input.companyId))
        .get();

      if (!targetCompany) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }
      if (targetCompany.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Company must be active to create a spool deployment" });
      }

      // Check subdomain uniqueness
      const existing = await ctx.db
        .select({ id: spoolDeployment.id })
        .from(spoolDeployment)
        .where(eq(spoolDeployment.subdomain, input.subdomain))
        .get();
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Subdomain already in use" });
      }

      // Generate shared secret
      const sharedSecret = crypto.randomUUID() + "-" + crypto.randomUUID();
      const sharedSecretHash = await hashSha256(sharedSecret);
      const sharedSecretWrapped = await wrapSecret(sharedSecret, env.ORRN_MASTER_KEY);

      // Generate instance ID
      const instanceId = crypto.randomUUID();

      // Create Cloudflare Tunnel (a stub on the local worker, see useLocalTunnelStub)
      const tunnelName = `spool-${input.subdomain}`;
      let cfTunnelId: string;
      let cfTunnelToken: string;
      if (useLocalTunnelStub(ctx.request.url)) {
        cfTunnelId = `${LOCAL_TUNNEL_PREFIX}${crypto.randomUUID()}`;
        cfTunnelToken = `${LOCAL_TUNNEL_PREFIX}token-${crypto.randomUUID()}`;
      } else {
        try {
          const tunnel = await createTunnel(tunnelName);
          cfTunnelId = tunnel.id;
          cfTunnelToken = tunnel.token;
        } catch (err) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to create Cloudflare Tunnel: ${err instanceof Error ? err.message : String(err)}`,
          });
        }

        // Create DNS CNAME record
        try {
          await createCnameRecord(input.subdomain, cfTunnelId);
        } catch (err) {
          // Rollback tunnel creation
          try { await deleteTunnel(cfTunnelId); } catch { /* best effort */ }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to create DNS record: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // Wrap the CF tunnel token
      const cfTunnelTokenWrapped = await wrapSecret(cfTunnelToken, env.ORRN_MASTER_KEY);

      const spoolDomain = `${input.subdomain}${SPOOL_DOMAIN_SUFFIX}`;
      const id = crypto.randomUUID();

      // Insert deployment record
      await ctx.db.insert(spoolDeployment).values({
        id,
        companyId: input.companyId,
        instanceId,
        status: "pending",
        subdomain: input.subdomain,
        nodeDomain: spoolDomain,
        cfTunnelId,
        cfTunnelTokenWrapped,
        sharedSecretHash,
        sharedSecretWrapped,
      });

      return {
        id,
        instanceId,
        subdomain: input.subdomain,
        spoolDomain,
        sharedSecret, // Only returned once at creation time
        cfTunnelToken, // Only returned once at creation time
      };
    }),

  /** Get a single deployment's details. */
  spoolDeploymentGet: platformGuard("platform.spool.manage")
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({
          id: spoolDeployment.id,
          companyId: spoolDeployment.companyId,
          instanceId: spoolDeployment.instanceId,
          status: spoolDeployment.status,
          subdomain: spoolDeployment.subdomain,
          spoolDomain: spoolDeployment.nodeDomain,
          cfTunnelId: spoolDeployment.cfTunnelId,
          spoolVersion: spoolDeployment.runtimeVersion,
          lastSeenAt: spoolDeployment.lastHeartbeatAt,
          createdAt: spoolDeployment.createdAt,
          updatedAt: spoolDeployment.updatedAt,
          companyName: company.name,
        })
        .from(spoolDeployment)
        .innerJoin(company, eq(company.id, spoolDeployment.companyId))
        .where(eq(spoolDeployment.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      return row;
    }),

  /** Revoke a spool deployment — deletes the CF tunnel and DNS record. */
  spoolDeploymentRevoke: platformGuard("platform.spool.manage")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(spoolDeployment)
        .where(eq(spoolDeployment.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (row.status === "revoked") {
        return { success: true };
      }

      // Delete DNS record (stub tunnels from the local worker have none)
      if (row.cfTunnelId && !row.cfTunnelId.startsWith(LOCAL_TUNNEL_PREFIX)) {
        const dnsRecordId = await findDnsRecord(row.subdomain);
        if (dnsRecordId) {
          try { await deleteDnsRecord(dnsRecordId); } catch { /* best effort */ }
        }
        // Delete tunnel
        try { await deleteTunnel(row.cfTunnelId); } catch { /* best effort */ }
      }

      await ctx.db
        .update(spoolDeployment)
        .set({ status: "revoked" })
        .where(eq(spoolDeployment.id, input.id));

      return { success: true };
    }),

  /** Legacy secrets rotate immediately; enrolled V1 nodes stage a non-stranding overlapping rotation. */
  spoolDeploymentRegenerateSecret: platformGuard("platform.spool.manage")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(spoolDeployment)
        .where(eq(spoolDeployment.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (row.status === "revoked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot regenerate secret for a revoked deployment" });
      }

      if (row.installId !== null || row.enrollmentIssuedAt !== null) {
        const staged = await stageEdgeSecretRotation(ctx.db, {
          deploymentId: row.id,
          masterKey: env.ORRN_MASTER_KEY,
        });
        return {
          sharedSecret: staged.pendingSecret,
          pendingCredentialVersion: staged.pendingCredentialVersion,
          overlap: true,
        };
      }

      const newSecret = crypto.randomUUID() + "-" + crypto.randomUUID();
      const newHash = await hashSha256(newSecret);
      const newWrapped = await wrapSecret(newSecret, env.ORRN_MASTER_KEY);

      await ctx.db
        .update(spoolDeployment)
        .set({ sharedSecretHash: newHash, sharedSecretWrapped: newWrapped })
        .where(eq(spoolDeployment.id, input.id));

      return { sharedSecret: newSecret, pendingCredentialVersion: null, overlap: false };
    }),

  spoolDeploymentDockerInstallScript: platformGuard("platform.spool.manage")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(spoolDeployment)
        .where(eq(spoolDeployment.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (row.status === "revoked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot generate install script for a revoked deployment" });
      }
      if (row.installId !== null || row.enrollmentIssuedAt !== null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ORRN Edge uses enrollment and an immutable release download, not a legacy secret-bearing install script",
        });
      }


      const sharedSecret = await unwrapSecret(row.sharedSecretWrapped, env.ORRN_MASTER_KEY);
      const cfTunnelToken = await unwrapSecret(row.cfTunnelTokenWrapped, env.ORRN_MASTER_KEY);
      const releaseTag = await resolveSpoolReleaseTag(row.runtimeVersion ?? undefined);
      const image = `ghcr.io/abhalala/orrn-spool:${releaseTag}`;
      const script = buildDockerInstallScript({
        subdomain: row.subdomain,
        spoolDomain: row.nodeDomain,
        image,
        instanceId: row.instanceId,
        sharedSecret,
        cfTunnelToken,
        orrnServerUrl: env.BETTER_AUTH_URL,
      });

      return {
        filename: `install-${row.subdomain}-docker.sh`,
        image,
        releaseTag,
        script,
      };
    }),

  /** Generate a short-lived download URL for a deployment's deliverable archive. */
  spoolDeploymentDownloadUrl: platformGuard("platform.spool.manage")
    .input(z.object({
      id: z.string(),
      platform: z.enum(["linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64", "windows-amd64", "docker"] as const),
      version: releaseSemverSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(spoolDeployment)
        .where(eq(spoolDeployment.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (row.status === "revoked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot download deliverable for a revoked deployment" });
      }

      if (row.installId !== null || row.enrollmentIssuedAt !== null) {
        if (input.platform !== "linux-amd64" && input.platform !== "linux-arm64" && input.platform !== "windows-amd64" && input.platform !== "docker") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported ORRN Edge platform" });
        }
        const version = input.version ?? row.runtimeVersion;
        if (!version) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Select an explicit ORRN Edge release version" });
        }
        try {
          const release = await resolveEdgeReleaseArtifact(version, input.platform === "docker" ? "linux-amd64" : input.platform);
          return {
            downloadUrl: input.platform === "docker" ? release.dockerImage : release.artifact.url,
            filename: input.platform === "docker" ? "orrn-edge-docker" : release.artifact.filename,
            sha256: input.platform === "docker" ? null : release.artifact.sha256,
            releaseVersion: release.version,
            manifestUrl: release.manifestUrl,
            dockerImage: input.platform === "docker" ? release.dockerImage : null,
          };
        } catch (error) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: error instanceof Error ? error.message : "Failed to resolve the ORRN Edge release",
          });
        }
      }
      if (input.platform === "linux-arm64" || input.platform === "docker") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Docker and Linux ARM64 are available only for ORRN Edge nodes" });
      }


      // Generate a short-lived download token signed with ORRN_MASTER_KEY
      const token = await signDownloadToken(input.id, input.platform, env.ORRN_MASTER_KEY);
      const downloadUrl = `${env.BETTER_AUTH_URL}/api/spool/deployments/${input.id}/download/${input.platform}?token=${token}`;

      return {
        downloadUrl,
        filename: getDeliverableFilename(row.subdomain, input.platform),
        sha256: null,
        releaseVersion: null,
        manifestUrl: null,
        dockerImage: null,
      };
    }),

  /** Create a new outbound-only Edge V1 node and return a 15-minute single-use enrollment token (no Cloudflare API calls). */
  edgeNodeCreate: platformGuard("platform.spool.manage")
    .input(
      z.object({
        companyId: z.string().min(1).max(64),
        nodeName: z.string().trim().min(2).max(64).default("Primary edge node"),
        siteLabel: z.string().trim().min(2).max(64).default("Main facility"),
        subdomain: z
          .string()
          .min(3)
          .max(63)
          .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Subdomain must be a valid DNS label")
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const targetCompany = await ctx.db
        .select({ id: company.id, name: company.name, status: company.status })
        .from(company)
        .where(eq(company.id, input.companyId))
        .get();

      if (!targetCompany) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }
      if (targetCompany.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Company must be active to create an edge node" });
      }

      if (input.subdomain) {
        const existing = await ctx.db
          .select({ id: spoolDeployment.id })
          .from(spoolDeployment)
          .where(eq(spoolDeployment.subdomain, input.subdomain))
          .get();
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "Subdomain already in use" });
        }
      }

      return createEdgeEnrollmentNode(ctx.db, {
        companyId: input.companyId,
        nodeName: input.nodeName,
        siteLabel: input.siteLabel,
        subdomain: input.subdomain,
        masterKey: env.ORRN_MASTER_KEY,
      });
    }),

  /** Re-issue a 15-minute single-use enrollment token for an existing Edge node. */
  edgeNodeIssueEnrollmentToken: platformGuard("platform.spool.manage")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(spoolDeployment)
        .where(eq(spoolDeployment.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (row.status === "revoked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot issue enrollment token for a revoked deployment" });
      }
      if (row.installId === null && row.enrollmentIssuedAt === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Legacy deployments cannot be converted to ORRN Edge enrollment" });
      }

      return issueEdgeEnrollmentToken(ctx.db, { deploymentId: row.id });
    }),

  /** Stage a non-stranding overlapping secret rotation for an Edge V1 node. */
  edgeNodeRotateSecret: platformGuard("platform.spool.manage")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(spoolDeployment)
        .where(eq(spoolDeployment.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (row.status === "revoked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot rotate secret for a revoked deployment" });
      }
      if (row.installId === null && row.enrollmentIssuedAt === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Legacy deployments cannot use ORRN Edge rotation" });
      }

      return stageEdgeSecretRotation(ctx.db, {
        deploymentId: row.id,
        masterKey: env.ORRN_MASTER_KEY,
      });
    }),

  /** Replace an Edge V1 node's desired printers; the agent applies the new config version on its next poll. */
  edgeNodeSetPrinters: platformGuard("platform.spool.manage")
    .input(z.object({ id: z.string(), printers: edgeDesiredPrintersSchema }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: spoolDeployment.id, status: spoolDeployment.status })
        .from(spoolDeployment)
        .where(eq(spoolDeployment.id, input.id))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (row.status === "revoked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot configure printers on a revoked deployment" });
      }

      return setEdgeNodePrinters(ctx.db, { deploymentId: row.id, printers: input.printers });
    }),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hashSha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}