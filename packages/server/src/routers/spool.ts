import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import type { OrrnDb } from "@orrn/db";
import { die } from "@orrn/db/schema/catalog";
import { bundle, bundleGroup } from "@orrn/db/schema/inventory";
import { labelTemplate, printLog, printerProfile, printStatuses } from "@orrn/db/schema/printing";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { unwrapSecret } from "@orrn/crypto";
import { env } from "@orrn/env/server";

import { buildBundleLabelVariables } from "../lib/bundle-label";
import { SpoolClient } from "../lib/spool-client";
import { can } from "../lib/permissions";
import { companyProcedure, roleGuard, router } from "../index";

/** Get the active spool deployment for the current company, or throw. */
async function getActiveDeployment(ctx: { db: OrrnDb; companyId: string }) {
  const deployment = await ctx.db
    .select()
    .from(spoolDeployment)
    .where(
      and(
        eq(spoolDeployment.companyId, ctx.companyId),
        eq(spoolDeployment.status, "active"),
      ),
    )
    .get();

  if (!deployment) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No active spool deployment for this company" });
  }

  return deployment;
}

/** Create a SpoolClient from the deployment's wrapped secrets. */
async function createSpoolClient(deployment: Awaited<ReturnType<typeof getActiveDeployment>>) {
  const sharedSecret = await unwrapSecret(deployment.sharedSecretWrapped, env.ORRN_MASTER_KEY);
  return new SpoolClient(`https://${deployment.spoolDomain}`, sharedSecret);
}

export const spoolRouter = router({
  // ─── Printers ────────────────────────────────────────────────────────────────

  listPrinters: companyProcedure
    .use(({ ctx, next }) => {
      if (!can({ company: { role: ctx.role! }, isPlatformAdmin: false }, "spool.list_printers")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
      }
      return next({ ctx });
    })
    .query(async ({ ctx }) => {
      const deployment = await getActiveDeployment(ctx);
      const client = await createSpoolClient(deployment);
      return client.listPrinters();
    }),

  addPrinter: roleGuard("owner", "admin", "manager")
    .input(
      z.object({
        name: z.string().min(1).max(255),
        ipAddress: z.string().min(1),
        port: z.number().int().min(1).max(65535).default(9100),
        dpi: z.number().int().default(203),
        labelWidthMm: z.number().positive(),
        labelHeightMm: z.number().positive(),
        gapMm: z.number().nonnegative().default(2),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deployment = await getActiveDeployment(ctx);
      const client = await createSpoolClient(deployment);
      return client.addPrinter({
        name: input.name,
        ip_address: input.ipAddress,
        port: input.port,
        dpi: input.dpi,
        label_width_mm: input.labelWidthMm,
        label_height_mm: input.labelHeightMm,
        gap_mm: input.gapMm,
      });
    }),

  getPrinterStatus: companyProcedure
    .input(z.object({ printerId: z.number() }))
    .query(async ({ ctx, input }) => {
      const deployment = await getActiveDeployment(ctx);
      const client = await createSpoolClient(deployment);
      return client.getPrinterStatus(input.printerId);
    }),

  testPrinter: roleGuard("owner", "admin", "manager")
    .input(z.object({ printerId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await getActiveDeployment(ctx);
      const client = await createSpoolClient(deployment);
      await client.testPrint(input.printerId);
      return { success: true };
    }),

  // ─── Templates ──────────────────────────────────────────────────────────────

  listTemplates: companyProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: labelTemplate.id,
        name: labelTemplate.name,
        kind: labelTemplate.kind,
        spoolTemplateId: labelTemplate.spoolTemplateId,
        spoolPushedAt: labelTemplate.spoolPushedAt,
        version: labelTemplate.version,
        createdAt: labelTemplate.createdAt,
        updatedAt: labelTemplate.updatedAt,
      })
      .from(labelTemplate)
      .where(
        and(
          eq(labelTemplate.companyId, ctx.companyId!),
          // Only non-deleted templates
        ),
      )
      .orderBy(desc(labelTemplate.createdAt));

    return rows;
  }),


  listProfiles: companyProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: printerProfile.id,
        name: printerProfile.name,
        spoolPrinterId: printerProfile.spoolPrinterId,
        templateId: printerProfile.templateId,
        templateName: labelTemplate.name,
        templateKind: labelTemplate.kind,
        defaultCopies: printerProfile.defaultCopies,
        createdAt: printerProfile.createdAt,
      })
      .from(printerProfile)
      .innerJoin(labelTemplate, eq(labelTemplate.id, printerProfile.templateId))
      .where(and(eq(printerProfile.companyId, ctx.companyId!), isNull(printerProfile.deletedAt)))
      .orderBy(desc(printerProfile.createdAt));

    return rows;
  }),

  pushTemplate: roleGuard("owner", "admin", "manager")
    .input(z.object({ templateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const template = await ctx.db
        .select()
        .from(labelTemplate)
        .where(and(eq(labelTemplate.id, input.templateId), eq(labelTemplate.companyId, ctx.companyId!)))
        .get();

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      const deployment = await getActiveDeployment(ctx);
      const client = await createSpoolClient(deployment);

      const schema = template.schema as Record<string, unknown>;
      const widthMm = (schema.width_mm as number) ?? 100;
      const heightMm = (schema.height_mm as number) ?? 50;

      if (template.spoolTemplateId) {
        // Update existing template on spool
        await client.updateTemplate(Number(template.spoolTemplateId), {
          name: template.name,
          schema_json: JSON.stringify(schema),
          width_mm: widthMm,
          height_mm: heightMm,
        });
      } else {
        // Push new template to spool
        const result = await client.pushTemplate({
          name: template.name,
          description: `ORRN template: ${template.name}`,
          schema_json: JSON.stringify(schema),
          width_mm: widthMm,
          height_mm: heightMm,
        });

        // Save the spool template ID
        await ctx.db
          .update(labelTemplate)
          .set({
            spoolTemplateId: String(result.id),
            spoolPushedAt: new Date(),
          })
          .where(eq(labelTemplate.id, input.templateId));
      }

      return { success: true };
    }),

  // ─── Print Jobs ──────────────────────────────────────────────────────────────

  createJob: roleGuard("owner", "admin", "manager", "operator")
    .input(
      z.object({
        profileId: z.string(),
        bundleId: z.string().optional(),
        variables: z.record(z.string(), z.string()),
        copies: z.number().int().min(1).default(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Look up the printer profile
      const profile = await ctx.db
        .select()
        .from(printerProfile)
        .where(and(eq(printerProfile.id, input.profileId), eq(printerProfile.companyId, ctx.companyId!)))
        .get();

      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Printer profile not found" });
      }

      // Look up the template
      const template = await ctx.db
        .select()
        .from(labelTemplate)
        .where(eq(labelTemplate.id, profile.templateId))
        .get();

      if (!template || !template.spoolTemplateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Template not pushed to spool yet" });
      }

      const deployment = await getActiveDeployment(ctx);
      const client = await createSpoolClient(deployment);

      // Create the print log entry first
      const printLogId = crypto.randomUUID();
      await ctx.db.insert(printLog).values({
        id: printLogId,
        companyId: ctx.companyId!,
        bundleId: input.bundleId ?? null,
        templateId: template.id,
        profileId: profile.id,
        requestedBy: ctx.session!.user.id,
        status: "queued",
        layout: "x0",
        variables: input.variables,
        attempt: 1,
      });

      // Submit to spool
      try {
        const result = await client.createJob({
          printer_id: Number(profile.spoolPrinterId),
          template_id: Number(template.spoolTemplateId),
          variables: input.variables,
          copies: input.copies,
        });

        // Update print log with spool job ID and status
        await ctx.db
          .update(printLog)
          .set({
            spoolJobId: String(result.id),
            status: "sent",
          })
          .where(eq(printLog.id, printLogId));

        return { id: printLogId, spoolJobId: result.id };
      } catch (err) {
        // Mark as failed
        await ctx.db
          .update(printLog)
          .set({
            status: "failed",
            responseText: err instanceof Error ? err.message : String(err),
          })
          .where(eq(printLog.id, printLogId));

        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Failed to submit print job: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  printBundleLabel: roleGuard("owner", "admin", "manager", "operator")
    .input(
      z.object({
        bundleId: z.string(),
        profileId: z.string().optional(),
        layout: z.string().regex(/^x\d+$/).default("x0"),
        copies: z.number().int().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bundleRow = await ctx.db.query.bundle.findFirst({
        where: and(eq(bundle.id, input.bundleId), eq(bundle.companyId, ctx.companyId)),
      });
      if (!bundleRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      }

      const groupRow = await ctx.db.query.bundleGroup.findFirst({
        where: and(eq(bundleGroup.id, bundleRow.groupId), eq(bundleGroup.companyId, ctx.companyId)),
      });
      if (!groupRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundling session not found" });
      }

      const dieRow = await ctx.db.query.die.findFirst({
        where: and(eq(die.id, bundleRow.dieId), eq(die.companyId, ctx.companyId)),
      });

      const profile = input.profileId
        ? await ctx.db
            .select()
            .from(printerProfile)
            .where(and(eq(printerProfile.id, input.profileId), eq(printerProfile.companyId, ctx.companyId!)))
            .get()
        : await ctx.db
            .select()
            .from(printerProfile)
            .innerJoin(labelTemplate, eq(labelTemplate.id, printerProfile.templateId))
            .where(
              and(
                eq(printerProfile.companyId, ctx.companyId!),
                eq(labelTemplate.kind, "bundle"),
                isNull(printerProfile.deletedAt),
                isNull(labelTemplate.deletedAt),
              ),
            )
            .orderBy(desc(printerProfile.createdAt))
            .limit(1)
            .get()
            .then((row) => row?.printer_profile ?? null);

      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle printer profile not found" });
      }

      const template = await ctx.db
        .select()
        .from(labelTemplate)
        .where(and(eq(labelTemplate.id, profile.templateId), eq(labelTemplate.companyId, ctx.companyId!)))
        .get();
      if (!template || !template.spoolTemplateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Bundle label template is not pushed to spool yet" });
      }

      const variables = buildBundleLabelVariables({ bundleRow, groupRow, dieRow: dieRow ?? null, layout: input.layout });
      const deployment = await getActiveDeployment(ctx);
      const client = await createSpoolClient(deployment);
      const printLogId = crypto.randomUUID();
      const copies = input.copies ?? profile.defaultCopies;

      await ctx.db.insert(printLog).values({
        id: printLogId,
        companyId: ctx.companyId!,
        bundleId: bundleRow.id,
        templateId: template.id,
        profileId: profile.id,
        requestedBy: ctx.session!.user.id,
        status: "queued",
        layout: input.layout,
        variables,
        attempt: 1,
      });

      try {
        const result = await client.createJob({
          printer_id: Number(profile.spoolPrinterId),
          template_id: Number(template.spoolTemplateId),
          variables,
          copies,
        });

        await ctx.db
          .update(printLog)
          .set({ spoolJobId: String(result.id), status: "sent" })
          .where(eq(printLog.id, printLogId));

        return { id: printLogId, spoolJobId: result.id, variables };
      } catch (err) {
        await ctx.db
          .update(printLog)
          .set({
            status: "failed",
            responseText: err instanceof Error ? err.message : String(err),
          })
          .where(eq(printLog.id, printLogId));

        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Failed to submit bundle label print: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  listJobs: companyProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        status: z.enum(printStatuses).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [eq(printLog.companyId, ctx.companyId!)];
      if (input.status) filters.push(eq(printLog.status, input.status));
      const whereClause = and(...filters);

      const rows = await ctx.db
        .select()
        .from(printLog)
        .where(whereClause)
        .orderBy(desc(printLog.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  getJobStatus: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(printLog)
        .where(and(eq(printLog.id, input.id), eq(printLog.companyId, ctx.companyId!)))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Print job not found" });
      }

      return row;
    }),

  cancelJob: roleGuard("owner", "admin", "manager")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(printLog)
        .where(and(eq(printLog.id, input.id), eq(printLog.companyId, ctx.companyId!)))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Print job not found" });
      }

      if (row.spoolJobId) {
        const deployment = await getActiveDeployment(ctx);
        const client = await createSpoolClient(deployment);
        try {
          await client.cancelJob(Number(row.spoolJobId));
        } catch {
          // Best effort — the job may have already completed
        }
      }

      await ctx.db
        .update(printLog)
        .set({ status: "failed", responseText: "Cancelled by user" })
        .where(eq(printLog.id, input.id));

      return { success: true };
    }),

  retryJob: roleGuard("owner", "admin", "manager")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(printLog)
        .where(and(eq(printLog.id, input.id), eq(printLog.companyId, ctx.companyId!)))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Print job not found" });
      }

      if (row.spoolJobId) {
        const deployment = await getActiveDeployment(ctx);
        const client = await createSpoolClient(deployment);
        try {
          await client.retryJob(Number(row.spoolJobId));
        } catch {
          // Best effort
        }
      }

      await ctx.db
        .update(printLog)
        .set({ status: "queued", attempt: row.attempt + 1 })
        .where(eq(printLog.id, input.id));

      return { success: true };
    }),

  // ─── Deployment Status ──────────────────────────────────────────────────────

  deploymentStatus: companyProcedure.query(async ({ ctx }) => {
    const deployment = await ctx.db
      .select({
        id: spoolDeployment.id,
        status: spoolDeployment.status,
        subdomain: spoolDeployment.subdomain,
        spoolDomain: spoolDeployment.spoolDomain,
        spoolVersion: spoolDeployment.spoolVersion,
        lastSeenAt: spoolDeployment.lastSeenAt,
      })
      .from(spoolDeployment)
      .where(eq(spoolDeployment.companyId, ctx.companyId!))
      .orderBy(desc(spoolDeployment.createdAt))
      .limit(1)
      .get();

    return deployment ?? null;
  }),
});