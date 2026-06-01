import { TRPCError } from "@trpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { spoolDeployment, spoolDeploymentStatuses } from "@orrn/db/schema/spool";
import { company } from "@orrn/db/schema/tenant";
import { wrapSecret } from "@orrn/crypto";
import { env } from "@orrn/env/server";

import { createCnameRecord, createTunnel, deleteDnsRecord, deleteTunnel, findDnsRecord } from "../../lib/cloudflare";
import { signDownloadToken } from "../../lib/spool-crypto";
import { getDeliverableFilename } from "../../lib/spool-packager";
import { platformGuard } from "../../index";

const SPOOL_DOMAIN_SUFFIX = ".spool.orrn.in";

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
          spoolDomain: spoolDeployment.spoolDomain,
          spoolVersion: spoolDeployment.spoolVersion,
          lastSeenAt: spoolDeployment.lastSeenAt,
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
        companyId: z.uuid(),
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

      // Create Cloudflare Tunnel
      const tunnelName = `spool-${input.subdomain}`;
      let cfTunnelId: string;
      let cfTunnelToken: string;
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
        spoolDomain,
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
          spoolDomain: spoolDeployment.spoolDomain,
          cfTunnelId: spoolDeployment.cfTunnelId,
          spoolVersion: spoolDeployment.spoolVersion,
          lastSeenAt: spoolDeployment.lastSeenAt,
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

      // Delete DNS record
      if (row.cfTunnelId) {
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

  /** Regenerate the shared secret for a deployment. Invalidates the old one. */
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

      const newSecret = crypto.randomUUID() + "-" + crypto.randomUUID();
      const newHash = await hashSha256(newSecret);
      const newWrapped = await wrapSecret(newSecret, env.ORRN_MASTER_KEY);

      await ctx.db
        .update(spoolDeployment)
        .set({ sharedSecretHash: newHash, sharedSecretWrapped: newWrapped })
        .where(eq(spoolDeployment.id, input.id));

      return { sharedSecret: newSecret };
    }),

  /** Generate a short-lived download URL for a deployment's deliverable archive. */
  spoolDeploymentDownloadUrl: platformGuard("platform.spool.manage")
    .input(z.object({
      id: z.string(),
      platform: z.enum(["linux-amd64", "darwin-amd64", "darwin-arm64", "windows-amd64"] as const),
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

      // Generate a short-lived download token signed with ORRN_MASTER_KEY
      const token = await signDownloadToken(input.id, input.platform, env.ORRN_MASTER_KEY);
      const downloadUrl = `${env.BETTER_AUTH_URL}/api/spool/deployments/${input.id}/download/${input.platform}?token=${token}`;

      return { downloadUrl, filename: getDeliverableFilename(row.subdomain, input.platform) };
    }),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hashSha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}