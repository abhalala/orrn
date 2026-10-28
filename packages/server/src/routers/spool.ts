import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { OrrnDb } from "@orrn/db";
import { die } from "@orrn/db/schema/catalog";
import { cast } from "@orrn/db/schema/foundry";
import { bundle, bundleGroup } from "@orrn/db/schema/inventory";
import { labelTemplate, printLog, printerProfile, printStatuses } from "@orrn/db/schema/printing";
import type { LabelDocument } from "@orrn/domain";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { unwrapSecret } from "@orrn/crypto";
import { env } from "@orrn/env/server";

import { buildBundleLabelVariables } from "../lib/bundle-label";
import { SpoolClient, SpoolHttpError, spoolBaseUrl } from "../lib/spool-client";
import {
  enqueueEdgeCancelCommand,
  enqueueEdgeDeviceActionCommand,
  enqueueEdgePrintCommand,
  retryEdgePrintCommand,
  enqueueEdgeTestPrintCommand,
} from "../lib/edge-v1";
import { can } from "../lib/permissions";
import { writeAudit } from "../lib/audit";
import { cloneLabelDraft, createLabelDraft, getLabelDocument, listLabelDocuments, publishLabelDraft, updateLabelDraft } from "../lib/label-documents";
import { actionProcedure, companyProcedure, router } from "../index";

/** Hash the frozen identifiers and label content; V1 uses string IDs while legacy keeps numeric IDs. */
async function labelPayloadHash(body: { printer_id: number | string; template_id: number | string; variables: Record<string, unknown>; copies: number }): Promise<string> {
  const variables = Object.fromEntries(Object.entries(body.variables).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const text = JSON.stringify({ c: body.copies, p: body.printer_id, t: body.template_id, v: variables });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The spool's exactly-once key (orrn-spool docs/print-exactly-once.md): one per print intent,
 * `bundle:<serial>:label:v<template version>:attempt:<n>`. The spool accepts 1-200 characters from
 * A-Z a-z 0-9 . _ : / # @ = + ~ -, so any other character of a serial becomes `_`.
 */
export function spoolJobKey(serial: string, labelVersion: number, attempt: number): string {
  return `bundle:${serial.replace(/[^A-Za-z0-9._:/#@=+~-]/g, "_")}:label:v${labelVersion}:attempt:${attempt}`.slice(0, 200);
}
import { loadPackLabelVariables } from "../lib/pack";

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

type ActiveSpoolDeployment = typeof spoolDeployment.$inferSelect;

/** Create a SpoolClient from the deployment's wrapped secrets. */
async function createSpoolClient(deployment: ActiveSpoolDeployment) {
  const sharedSecret = await unwrapSecret(deployment.sharedSecretWrapped, env.ORRN_MASTER_KEY);
  return new SpoolClient(spoolBaseUrl(deployment.nodeDomain), sharedSecret);
}

export const spoolRouter = router({
  labelDocuments: router({
    list: companyProcedure.query(async ({ ctx }) => listLabelDocuments(ctx.db, ctx.companyId)),
    get: companyProcedure.input(z.object({ templateId: z.string().uuid() })).query(async ({ ctx, input }) => getLabelDocument(ctx.db, ctx.companyId, input.templateId)),
    createDraft: actionProcedure("spool.push_templates")
      .input(z.object({ name: z.string().trim().min(1).max(255), document: z.custom<LabelDocument>() }))
      .mutation(async ({ ctx, input }) => createLabelDraft(ctx.db, ctx.companyId, input.name, input.document)),
    updateDraft: actionProcedure("spool.push_templates")
      .input(z.object({ templateId: z.string().uuid(), document: z.custom<LabelDocument>() }))
      .mutation(async ({ ctx, input }) => updateLabelDraft(ctx.db, ctx.companyId, input.templateId, input.document)),
    clone: actionProcedure("spool.push_templates")
      .input(z.object({ templateId: z.string().uuid(), name: z.string().trim().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => cloneLabelDraft(ctx.db, ctx.companyId, input.templateId, input.name)),
    publish: actionProcedure("spool.push_templates")
      .input(z.object({ templateId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => publishLabelDraft(ctx.db, ctx.companyId, input.templateId)),
  }),

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
      if (deployment.installId !== null || Array.isArray(deployment.reportedPrinters)) {
        return deployment.reportedPrinters ?? [];
      }
      const client = await createSpoolClient(deployment);
      return client.listPrinters();
    }),

  addPrinter: actionProcedure("spool.manage_printers")
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

  updatePrinterPreferences: actionProcedure("spool.manage_printers")
    .input(z.object({
      profileId: z.string().uuid(),
      mediaType: z.enum(["gap", "black_mark", "continuous"]),
      mediaWidthMm: z.number().positive().max(300),
      mediaHeightMm: z.number().positive().max(300),
      gapMm: z.number().min(0).max(50),
      dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]),
      speedInSec: z.number().int().min(1).max(12),
      density: z.number().int().min(0).max(15),
      cutterEnabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.select().from(printerProfile)
        .where(and(eq(printerProfile.id, input.profileId), eq(printerProfile.companyId, ctx.companyId!), isNull(printerProfile.deletedAt)))
        .get();
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Printer profile not found" });
      const deployment = await getActiveDeployment(ctx);
      const now = new Date();
      const preferences = {
        mediaType: input.mediaType,
        mediaWidthMm: input.mediaWidthMm,
        mediaHeightMm: input.mediaHeightMm,
        gapMm: input.gapMm,
        dpi: input.dpi,
        speedInSec: input.speedInSec,
        density: input.density,
        cutterEnabled: input.cutterEnabled,
        updatedAt: now,
      };
      const isEdge = deployment.installId !== null || deployment.enrollmentIssuedAt !== null;
      if (!isEdge) {
        await ctx.db.update(printerProfile).set(preferences).where(eq(printerProfile.id, profile.id));
      } else {
        const desired = deployment.desiredPrinters ?? [];
        let found = false;
        const printers = desired.map((printer) => {
          if (printer.printerId !== profile.spoolPrinterId) return printer;
          found = true;
          return {
            ...printer,
            labelWidthMm: input.mediaWidthMm,
            labelHeightMm: input.mediaHeightMm,
            gapMm: input.gapMm,
            dpi: input.dpi,
            mediaType: input.mediaType,
            speedInSec: input.speedInSec,
            density: input.density,
            cutterEnabled: input.cutterEnabled,
          };
        });
        if (!found) throw new TRPCError({ code: "BAD_REQUEST", message: "Printer is not in the node desired configuration" });
        await ctx.db.batch([
          ctx.db.update(printerProfile).set(preferences).where(eq(printerProfile.id, profile.id)),
          ctx.db.update(spoolDeployment).set({ desiredPrinters: printers, configVersion: sql`${spoolDeployment.configVersion} + 1`, updatedAt: now }).where(eq(spoolDeployment.id, deployment.id)),
        ]);
      }
      const updated = await ctx.db.select().from(printerProfile).where(eq(printerProfile.id, profile.id)).get();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Printer profile not found after update" });
      return updated;
    }),

  getPrinterStatus: companyProcedure
    .input(z.object({ printerId: z.number() }))
    .query(async ({ ctx, input }) => {
      const deployment = await getActiveDeployment(ctx);
      const client = await createSpoolClient(deployment);
      return client.getPrinterStatus(input.printerId);
    }),

  testPrinter: actionProcedure("spool.manage_printers")
    .input(z.object({ printerId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await getActiveDeployment(ctx);
      if (deployment.installId !== null) {
        const cmd = await enqueueEdgeTestPrintCommand(ctx.db, {
          companyId: ctx.companyId!,
          deploymentId: deployment.id,
          printerId: String(input.printerId),
          requestedBy: ctx.session!.user.id,
        });
        return { success: true, commandId: cmd.commandId };
      }
      const client = await createSpoolClient(deployment);
      await client.testPrint(input.printerId);
      return { success: true };
    }),

  deviceAction: actionProcedure("spool.manage_printers")
    .input(z.object({
      profileId: z.string().uuid(),
      action: z.enum(["calibrate", "set_cutter", "set_rtc", "download_font"]),
      enabled: z.boolean().optional(),
      rtc: z.string().datetime().optional(),
      fontBase64: z.string().max(1_500_000).optional(),
    }).superRefine((input, ctx) => {
      if (input.action === "set_cutter" && input.enabled === undefined) ctx.addIssue({ code: "custom", message: "enabled is required" });
      if (input.action === "set_rtc" && !input.rtc) ctx.addIssue({ code: "custom", message: "rtc is required" });
      if (input.action === "download_font" && !input.fontBase64) ctx.addIssue({ code: "custom", message: "fontBase64 is required" });
    }))
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.select().from(printerProfile)
        .where(and(eq(printerProfile.id, input.profileId), eq(printerProfile.companyId, ctx.companyId!), isNull(printerProfile.deletedAt)))
        .get();
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Printer profile not found" });
      const deployment = await getActiveDeployment(ctx);
      if (deployment.installId === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Device actions require an ORRN Edge V1 node" });
      if (!(deployment.desiredPrinters ?? []).some((printer) => printer.printerId === profile.spoolPrinterId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Printer is not in the node desired configuration" });
      }
      const command = await enqueueEdgeDeviceActionCommand(ctx.db, {
        companyId: ctx.companyId!,
        deploymentId: deployment.id,
        printerId: profile.spoolPrinterId,
        requestedBy: ctx.session!.user.id,
        action: { action: input.action, enabled: input.enabled, rtc: input.rtc, fontBase64: input.fontBase64 },
      });
      await writeAudit(ctx, {
        action: "printer.device_action",
        subjectType: "printer_profile",
        subjectId: profile.id,
        meta: { action: input.action, commandId: command.commandId, deploymentId: deployment.id },
      });
      return { success: true, commandId: command.commandId };
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
        deploymentId: printerProfile.deploymentId,
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

  pushTemplate: actionProcedure("spool.push_templates")
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
      if (deployment.installId !== null || deployment.enrollmentIssuedAt !== null) {
        await ctx.db.batch([
          ctx.db
            .update(labelTemplate)
            .set({ spoolPushedAt: new Date() })
            .where(eq(labelTemplate.id, input.templateId)),
          ctx.db
            .update(spoolDeployment)
            .set({ configVersion: sql`${spoolDeployment.configVersion} + 1` })
            .where(eq(spoolDeployment.id, deployment.id)),
        ]);
        return { success: true };
      }

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

  createJob: actionProcedure("spool.create_jobs")
    .input(
      z.object({
        profileId: z.string(),
        bundleId: z.string().optional(),
        variables: z.record(z.string(), z.string()),
        copies: z.number().int().min(1).default(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db
        .select()
        .from(printerProfile)
        .where(and(eq(printerProfile.id, input.profileId), eq(printerProfile.companyId, ctx.companyId!)))
        .get();
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Printer profile not found" });
      }

      const template = await ctx.db
        .select()
        .from(labelTemplate)
        .where(and(eq(labelTemplate.id, profile.templateId), eq(labelTemplate.companyId, ctx.companyId!)))
        .get();
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      const deployment = profile.deploymentId
        ? await ctx.db
            .select()
            .from(spoolDeployment)
            .where(
              and(
                eq(spoolDeployment.id, profile.deploymentId),
                eq(spoolDeployment.companyId, ctx.companyId!),
                eq(spoolDeployment.status, "active"),
              ),
            )
            .get()
        : await getActiveDeployment(ctx);
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No active spool deployment for this printer profile" });
      }
      if (deployment.installId === null && deployment.enrollmentIssuedAt !== null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ORRN Edge node enrollment is incomplete" });
      }

      const printLogId = crypto.randomUUID();
      if (deployment.installId !== null) {
        const jobKey = `print:${printLogId}:label:v${template.version}:attempt:1`;
        const payloadHash = await labelPayloadHash({
          printer_id: profile.spoolPrinterId,
          template_id: template.id,
          variables: input.variables,
          copies: input.copies,
        });
        const enqueued = await enqueueEdgePrintCommand(ctx.db, {
          companyId: ctx.companyId!,
          deploymentId: deployment.id,
          templateId: template.id,
          profileId: profile.id,
          bundleId: input.bundleId ?? null,
          requestedBy: ctx.session!.user.id,
          jobKey,
          payloadHash,
          copies: input.copies,
          labelVersion: template.version,
          attempt: 1,
          variables: input.variables,
          printLogId,
        });
        return { id: enqueued.printLogId, commandId: enqueued.commandId, spoolJobId: null };
      }

      if (!template.spoolTemplateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Template not pushed to spool yet" });
      }
      const client = await createSpoolClient(deployment);
      await ctx.db.insert(printLog).values({
        id: printLogId,
        companyId: ctx.companyId!,
        bundleId: input.bundleId ?? null,
        templateId: template.id,
        profileId: profile.id,
        requestedBy: ctx.session!.user.id,
        status: "queued",
        deploymentId: deployment.id,
        copies: input.copies,
        layout: "x0",
        variables: input.variables,
        attempt: 1,
        labelVersion: template.version,
      });

      try {
        const result = await client.createJob({
          printer_id: Number(profile.spoolPrinterId),
          template_id: Number(template.spoolTemplateId),
          variables: input.variables,
          copies: input.copies,
        });
        await ctx.db
          .update(printLog)
          .set({ spoolJobId: String(result.id), status: "sent" })
          .where(eq(printLog.id, printLogId));
        return { id: printLogId, commandId: null, spoolJobId: result.id };
      } catch (err) {
        await ctx.db
          .update(printLog)
          .set({ status: "failed", responseText: err instanceof Error ? err.message : String(err) })
          .where(eq(printLog.id, printLogId));
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Failed to submit print job: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  printBundleLabel: actionProcedure("spool.create_jobs")
    .input(
      z.object({
        bundleId: z.string(),
        profileId: z.string().optional(),
        layout: z.string().regex(/^x\d+$/).default("x0"),
        copies: z.number().int().min(1).max(100).optional(),
        /**
         * BACKLOG 44: true only when a person asks for ANOTHER label of a bundle already printed
         * (the Reprint action). That is a new print intent (the spool job key's attempt + 1). Left
         * out, the call is the same print again (a retry, a double tap) and cannot make a second label.
         */
        reprint: z.boolean().default(false),
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
      // FP-PK-04/05: QR, cast, sales order, standard, party number, logo flag.
      const packVariables = await loadPackLabelVariables(ctx.db, ctx.companyId, bundleRow);

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
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle label template not found" });
      }

      const castRow = bundleRow.castId
        ? await ctx.db
            .select({ number: cast.number })
            .from(cast)
            .where(and(eq(cast.id, bundleRow.castId), eq(cast.companyId, ctx.companyId!)))
            .get()
        : null;
      const variables = buildBundleLabelVariables({
        bundleRow,
        groupRow,
        dieRow: dieRow ?? null,
        layout: input.layout,
        castRow: castRow ?? null,
      });
      const deployment = profile.deploymentId
        ? await ctx.db
            .select()
            .from(spoolDeployment)
            .where(
              and(
                eq(spoolDeployment.id, profile.deploymentId),
                eq(spoolDeployment.companyId, ctx.companyId!),
                eq(spoolDeployment.status, "active"),
              ),
            )
            .get()
        : await getActiveDeployment(ctx);

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No active spool deployment for this printer profile" });
      }
      if (deployment.installId === null && deployment.enrollmentIssuedAt !== null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ORRN Edge node enrollment is incomplete" });
      }
      if (deployment.installId === null && !template.spoolTemplateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Bundle label template is not pushed to spool yet" });
      }


      const printLogId = crypto.randomUUID();
      const copies = input.copies ?? profile.defaultCopies;
      Object.assign(variables, packVariables);

      // BACKLOG 44: the print intent. The first print of a bundle at a label version is attempt 1. The
      // attempt moves up when a person asks for a reprint of a label that went out (ANY row of the latest
      // attempt has a spool job id: the spool accepted that key, whatever its status became since), or
      // when the label content differs from what that attempt already sent (another profile, copies, a
      // changed sales order on the label): the spool would refuse that key as a conflict. Anything else
      // (a transport retry, a second tap, a reprint whose first try never reached the spool) reuses the
      // latest attempt, hence the key.
      const labelVersion = template.version;
      const isEdgeV1Node = deployment.installId !== null;
      const payloadHash = await labelPayloadHash({
        printer_id: isEdgeV1Node ? profile.spoolPrinterId : Number(profile.spoolPrinterId),
        template_id: isEdgeV1Node ? template.id : Number(template.spoolTemplateId),
        variables,
        copies,
      });
      const scope = and(eq(printLog.companyId, ctx.companyId!), eq(printLog.bundleId, bundleRow.id), eq(printLog.labelVersion, labelVersion));
      const [latest] = await ctx.db
        .select({ attempt: printLog.attempt })
        .from(printLog)
        .where(scope)
        .orderBy(desc(printLog.attempt))
        .limit(1);
      let attempt = 1;
      if (latest) {
        const rows = await ctx.db
          .select({ spoolJobId: printLog.spoolJobId, payloadHash: printLog.payloadHash })
          .from(printLog)
          .where(and(scope, eq(printLog.attempt, latest.attempt)));
        const went = rows.some((r) => r.spoolJobId != null);
        const changed = rows.some((r) => r.payloadHash != null && r.payloadHash !== payloadHash);
        attempt = (input.reprint && went) || changed ? latest.attempt + 1 : latest.attempt;
      }
      const jobKey = spoolJobKey(bundleRow.serial, labelVersion, attempt);

      if (isEdgeV1Node) {
        const enqueued = await enqueueEdgePrintCommand(ctx.db, {
          companyId: ctx.companyId!,
          deploymentId: deployment.id,
          templateId: template.id,
          profileId: profile.id,
          bundleId: bundleRow.id,
          requestedBy: ctx.session!.user.id,
          jobKey,
          payloadHash,
          copies,
          labelVersion,
          attempt,
          layout: input.layout,
          variables,
          printLogId,
        });
        return { id: enqueued.printLogId, commandId: enqueued.commandId, spoolJobId: null, variables };
      }

      const client = await createSpoolClient(deployment);
      await ctx.db.insert(printLog).values({
        id: printLogId,
        companyId: ctx.companyId!,
        bundleId: bundleRow.id,
        templateId: template.id,
        profileId: profile.id,
        requestedBy: ctx.session!.user.id,
        status: "queued",
        deploymentId: deployment.id,
        copies,
        layout: input.layout,
        variables,
        attempt,
        labelVersion,
        jobKey,
        payloadHash,
      });

      try {
        const result = await client.createJob({
          printer_id: Number(profile.spoolPrinterId),
          template_id: Number(template.spoolTemplateId),
          variables,
          copies,
          job_key: jobKey,
        });
        // `duplicate: true` (HTTP 200): this label is already queued or printed under the key. That is
        // success: the id recorded is the first job's, and nothing was queued again.

        await ctx.db
          .update(printLog)
          .set({ spoolJobId: String(result.id), status: "sent" })
          .where(eq(printLog.id, printLogId));
        // The spool took the label with the bundle's current party number: no "needs reprint" now (I3).
        await ctx.db
          .update(bundle)
          .set({ stickerStale: false })
          .where(and(eq(bundle.id, bundleRow.id), eq(bundle.companyId, ctx.companyId!), eq(bundle.stickerStale, true)));

        return { id: printLogId, commandId: null, spoolJobId: result.id, variables };
      } catch (err) {
        await ctx.db
          .update(printLog)
          .set({
            status: "failed",
            responseText: err instanceof Error ? err.message : String(err),
          })
          .where(eq(printLog.id, printLogId));

        // The same key came back for different label content: orrn built the key wrong. Never a quiet
        // success (a wrong label might be queued) and never retried; loud in the logs.
        if (err instanceof SpoolHttpError && err.status === 409 && err.code === "job_key_conflict") {
          console.error(`spool job_key_conflict (bug): key ${jobKey} was already used for a different label; print log ${printLogId}`);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "This label was already sent to the printer with different content. Ask support; nothing was printed again.",
          });
        }
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

  /**
   * The print queue screen: one page of jobs (newest first) with the printer
   * and bundle each belongs to, plus a count per status. Read-only, scoped to
   * the company, and it leaves out the label variables and the spool job id
   * (the screen only needs a reason, a time and what the job is for).
   */
  queue: actionProcedure("spool.view_queue")
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        status: z.enum(printStatuses).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = eq(printLog.companyId, ctx.companyId);
      const filtered = input.status ? and(scope, eq(printLog.status, input.status)) : scope;

      const [rows, grouped] = await Promise.all([
        ctx.db
          .select({
            id: printLog.id,
            status: printLog.status,
            attempt: printLog.attempt,
            responseText: printLog.responseText,
            layout: printLog.layout,
            createdAt: printLog.createdAt,
            updatedAt: printLog.updatedAt,
            profileName: printerProfile.name,
            bundleSerial: bundle.serial,
          })
          .from(printLog)
          .innerJoin(
            printerProfile,
            and(eq(printerProfile.id, printLog.profileId), eq(printerProfile.companyId, ctx.companyId)),
          )
          .leftJoin(bundle, and(eq(bundle.id, printLog.bundleId), eq(bundle.companyId, ctx.companyId)))
          .where(filtered)
          .orderBy(desc(printLog.createdAt), desc(printLog.id))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ status: printLog.status, n: count() })
          .from(printLog)
          .where(scope)
          .groupBy(printLog.status),
      ]);

      const allCounts: Record<(typeof printStatuses)[number], number> = {
        queued: 0,
        accepted: 0,
        sent: 0,
        success: 0,
        failed: 0,
        outcome_unknown: 0,
        cancelled: 0,
      };
      for (const g of grouped) allCounts[g.status] = g.n;
      const total = input.status
        ? allCounts[input.status]
        : printStatuses.reduce((sum, status) => sum + allCounts[status], 0);

      return { rows, total, counts: allCounts };

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

  cancelJob: actionProcedure("spool.manage_jobs")
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

      const deployment = row.deploymentId
        ? await ctx.db
            .select()
            .from(spoolDeployment)
            .where(and(eq(spoolDeployment.id, row.deploymentId), eq(spoolDeployment.companyId, ctx.companyId!)))
            .get()
        : row.spoolJobId
          ? await getActiveDeployment(ctx)
          : null;
      if (row.deploymentId && !deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Print node not found" });
      }

      if (deployment && deployment.installId !== null) {
        const command = await enqueueEdgeCancelCommand(ctx.db, {
          companyId: ctx.companyId!,
          deploymentId: deployment.id,
          printLogId: row.id,
          agentJobId: row.spoolJobId,
          jobKey: row.jobKey,
          reason: "Cancelled by user",
        });
        // Cancellation is unresolved until the node acknowledges it or reports the job state.
        return { success: true, commandId: command.commandId };
      }

      if (deployment && row.spoolJobId) {
        const client = await createSpoolClient(deployment);
        try {
          await client.cancelJob(Number(row.spoolJobId));
        } catch {
          // Legacy cancellation remains best effort.
        }
      }

      await ctx.db
        .update(printLog)
        .set({ status: "failed", responseText: "Cancelled by user" })
        .where(eq(printLog.id, input.id));

      return { success: true, commandId: null };
    }),

  retryJob: actionProcedure("spool.manage_jobs")
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

      const deployment = row.deploymentId
        ? await ctx.db
            .select()
            .from(spoolDeployment)
            .where(and(eq(spoolDeployment.id, row.deploymentId), eq(spoolDeployment.companyId, ctx.companyId!)))
            .get()
        : row.spoolJobId
          ? await getActiveDeployment(ctx)
          : null;
      if (row.deploymentId && !deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Print node not found" });
      }

      if (deployment && deployment.installId !== null) {
        const retried = await retryEdgePrintCommand(ctx.db, {
          companyId: ctx.companyId!,
          deploymentId: deployment.id,
          printLogId: row.id,
          requestedBy: ctx.session!.user.id,
        });
        return { success: true, id: retried.printLogId, commandId: retried.commandId, jobKey: retried.jobKey };
      }

      if (deployment && row.spoolJobId) {
        const client = await createSpoolClient(deployment);
        try {
          await client.retryJob(Number(row.spoolJobId));
        } catch {
          // Legacy retry remains best effort.
        }
      }

      await ctx.db
        .update(printLog)
        .set({ status: "queued", attempt: row.attempt + 1 })
        .where(eq(printLog.id, input.id));

      return { success: true, id: null, commandId: null, jobKey: null };
    }),

  // ─── Deployment Status ──────────────────────────────────────────────────────

  deploymentStatus: companyProcedure.query(async ({ ctx }) => {
    const deployment = await ctx.db
      .select({
        id: spoolDeployment.id,
        status: spoolDeployment.status,
        subdomain: spoolDeployment.subdomain,
        spoolDomain: spoolDeployment.nodeDomain,
        spoolVersion: spoolDeployment.runtimeVersion,
        lastSeenAt: spoolDeployment.lastHeartbeatAt,
        scaleConfigured: spoolDeployment.scaleConfigured,
        scaleSimulated: spoolDeployment.scaleSimulated,
        scaleLastFrameAt: spoolDeployment.scaleLastFrameAt,
        scaleReportedAt: spoolDeployment.scaleReportedAt,
        collectors: spoolDeployment.collectors,
        collectorsReportedAt: spoolDeployment.collectorsReportedAt,
      })
      .from(spoolDeployment)
      .where(eq(spoolDeployment.companyId, ctx.companyId!))
      .orderBy(desc(spoolDeployment.createdAt))
      .limit(1)
      .get();

    return deployment ?? null;
  }),
});