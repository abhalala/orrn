/**
 * XE PLATFORM row 83: plant API tokens and webhooks (Settings > Plant API). Opt-in module `api`; every procedure,
 * reads included, needs the module and `api.manage` (the plant admin; the owner holds every action).
 *
 * - A token is shown once (`create` returns it); only SHA-256(salt + secret) is kept. Revoke is final.
 * - A webhook gets a signing secret, shown once at `create`, stored AES-GCM wrapped with ORRN_MASTER_KEY because
 *   signing needs it back. The URL passes the SSRF guard at registration and again before every delivery.
 */
import { TRPCError } from "@trpc/server";
import { wrapSecret } from "@orrn/crypto";
import { atomicBatch } from "@orrn/db/atomic";
import { apiToken, webhookDelivery, webhookEndpoint } from "@orrn/db/schema";
import { API_TOKEN_SCOPES, isModuleOn, WEBHOOK_EVENT_KEYS } from "@orrn/domain";
import { env } from "@orrn/env/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { actionProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { now } from "../lib/clock";
import { createId } from "../lib/id";
import { companyModules, MODULE_OFF_MESSAGE } from "../lib/moduleGate";
import { mintApiToken, randomHex } from "../lib/publicApi/token";
import { currentResolver, scheduleDrain } from "../lib/webhooks/schedule";
import { checkWebhookUrl } from "../lib/webhooks/ssrf";

export const API_REFUSALS = {
  notFound: "Not found",
  invoicesNeedBilling: "Invoices can be read only when billing is on",
  urlRefused: "Use a public https address. orrn does not send to local, private or tailnet addresses",
  keyMissing: "Webhook signing is not set up on this server",
  tooMany: "A plant may keep at most 20 tokens and 10 webhooks",
} as const;

const MAX_TOKENS = 20;
const MAX_WEBHOOKS = 10;


/** `api.manage` and the `api` module, reads included (the router gate covers mutations only). */
const apiProcedure = actionProcedure("api.manage").use(async ({ ctx, next }) => {
  const modules = await companyModules(ctx.db, ctx.companyId);
  if (!isModuleOn(modules, "api")) throw new TRPCError({ code: "FORBIDDEN", message: MODULE_OFF_MESSAGE });
  return next({ ctx: { ...ctx, modules } });
});

const notFound = (): never => {
  throw new TRPCError({ code: "NOT_FOUND", message: API_REFUSALS.notFound });
};

const idInput = z.object({ id: z.string().min(1).max(64) });

export const apiAccessRouter = router({
  tokens: router({
    list: apiProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: apiToken.id,
          name: apiToken.name,
          scopes: apiToken.scopes,
          hint: apiToken.hint,
          expiresAt: apiToken.expiresAt,
          revokedAt: apiToken.revokedAt,
          lastUsedAt: apiToken.lastUsedAt,
          createdAt: apiToken.createdAt,
        })
        .from(apiToken)
        .where(eq(apiToken.companyId, ctx.companyId))
        .orderBy(desc(apiToken.createdAt))
        .limit(100);
      return { items: rows, billingOn: isModuleOn(ctx.modules, "billing") };
    }),

    create: apiProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(60),
          scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1).max(API_TOKEN_SCOPES.length),
          /** Days until it stops working; none = until revoked. */
          expiresInDays: z.number().int().min(1).max(730).nullable().default(null),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const scopes = [...new Set(input.scopes)].sort();
        if (scopes.includes("invoices.read") && !isModuleOn(ctx.modules, "billing")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: API_REFUSALS.invoicesNeedBilling });
        }
        const live = await ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(apiToken)
          .where(and(eq(apiToken.companyId, ctx.companyId), isNull(apiToken.revokedAt)))
          .get();
        if (Number(live?.n ?? 0) >= MAX_TOKENS) throw new TRPCError({ code: "BAD_REQUEST", message: API_REFUSALS.tooMany });
        const id = createId();
        const minted = await mintApiToken(id);
        const at = now();
        const expiresAt = input.expiresInDays ? new Date(at.getTime() + input.expiresInDays * 86_400_000) : null;
        await atomicBatch(ctx.db, [
          ctx.db.insert(apiToken).values({
            id,
            companyId: ctx.companyId,
            name: input.name,
            scopes,
            salt: minted.salt,
            tokenHash: minted.tokenHash,
            hint: minted.hint,
            expiresAt,
            createdBy: ctx.session.user.id,
            createdAt: at,
          }),
          auditInsert(ctx, { action: "api.token.create", subjectType: "api_token", subjectId: id, meta: { name: input.name, scopes, expiresAt: expiresAt?.toISOString() ?? null } }),
        ]);
        // Shown once. The key is named `token`, which the buddy's stripSecrets hides (the router is denied to it anyway).
        return { id, token: minted.token, hint: minted.hint, expiresAt };
      }),

    revoke: apiProcedure.input(idInput).mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: apiToken.id, name: apiToken.name, revokedAt: apiToken.revokedAt })
        .from(apiToken)
        .where(and(eq(apiToken.id, input.id), eq(apiToken.companyId, ctx.companyId)))
        .get();
      if (!row) notFound();
      if (row!.revokedAt) return { id: row!.id };
      await atomicBatch(ctx.db, [
        ctx.db
          .update(apiToken)
          .set({ revokedAt: now() })
          .where(and(eq(apiToken.id, input.id), eq(apiToken.companyId, ctx.companyId), isNull(apiToken.revokedAt))),
        auditInsert(ctx, { action: "api.token.revoke", subjectType: "api_token", subjectId: input.id, meta: { name: row!.name } }),
      ]);
      return { id: input.id };
    }),
  }),

  webhooks: router({
    list: apiProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: webhookEndpoint.id,
          url: webhookEndpoint.url,
          events: webhookEndpoint.events,
          active: webhookEndpoint.active,
          createdAt: webhookEndpoint.createdAt,
        })
        .from(webhookEndpoint)
        .where(eq(webhookEndpoint.companyId, ctx.companyId))
        .orderBy(desc(webhookEndpoint.createdAt))
        .limit(MAX_WEBHOOKS * 2);
      return { items: rows, events: [...WEBHOOK_EVENT_KEYS] };
    }),

    create: apiProcedure
      .input(z.object({ url: z.string().trim().min(1).max(500), events: z.array(z.enum(WEBHOOK_EVENT_KEYS)).min(1).max(WEBHOOK_EVENT_KEYS.length) }))
      .mutation(async ({ ctx, input }) => {
        const check = await checkWebhookUrl(input.url, currentResolver());
        if (!check.ok) throw new TRPCError({ code: "BAD_REQUEST", message: API_REFUSALS.urlRefused });
        const masterKey = (env as unknown as { ORRN_MASTER_KEY?: string }).ORRN_MASTER_KEY;
        if (!masterKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: API_REFUSALS.keyMissing });
        const count = await ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(webhookEndpoint)
          .where(eq(webhookEndpoint.companyId, ctx.companyId))
          .get();
        if (Number(count?.n ?? 0) >= MAX_WEBHOOKS) throw new TRPCError({ code: "BAD_REQUEST", message: API_REFUSALS.tooMany });
        const id = createId();
        const secret = `whsec_${randomHex(24)}`;
        const events = [...new Set(input.events)].sort();
        await atomicBatch(ctx.db, [
          ctx.db.insert(webhookEndpoint).values({
            id,
            companyId: ctx.companyId,
            url: input.url,
            events,
            secretWrapped: await wrapSecret(secret, masterKey),
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, { action: "api.webhook.create", subjectType: "webhook_endpoint", subjectId: id, meta: { host: new URL(input.url).host, events } }),
        ]);
        return { id, secret };
      }),

    /** Pause or resume a webhook, or change its events. */
    update: apiProcedure
      .input(idInput.extend({ active: z.boolean().optional(), events: z.array(z.enum(WEBHOOK_EVENT_KEYS)).min(1).max(WEBHOOK_EVENT_KEYS.length).optional() }))
      .mutation(async ({ ctx, input }) => {
        const row = await ctx.db
          .select({ id: webhookEndpoint.id, url: webhookEndpoint.url, active: webhookEndpoint.active, events: webhookEndpoint.events })
          .from(webhookEndpoint)
          .where(and(eq(webhookEndpoint.id, input.id), eq(webhookEndpoint.companyId, ctx.companyId)))
          .get();
        if (!row) notFound();
        const events = input.events ? [...new Set(input.events)].sort() : row!.events;
        const active = input.active ?? row!.active;
        await atomicBatch(ctx.db, [
          ctx.db.update(webhookEndpoint).set({ events, active }).where(and(eq(webhookEndpoint.id, input.id), eq(webhookEndpoint.companyId, ctx.companyId))),
          auditInsert(ctx, {
            action: "api.webhook.update",
            subjectType: "webhook_endpoint",
            subjectId: input.id,
            meta: { host: new URL(row!.url).host, before: { active: row!.active, events: row!.events }, after: { active, events } },
          }),
        ]);
        return { id: input.id };
      }),

    delete: apiProcedure.input(idInput).mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: webhookEndpoint.id, url: webhookEndpoint.url })
        .from(webhookEndpoint)
        .where(and(eq(webhookEndpoint.id, input.id), eq(webhookEndpoint.companyId, ctx.companyId)))
        .get();
      if (!row) notFound();
      await atomicBatch(ctx.db, [
        ctx.db.delete(webhookEndpoint).where(and(eq(webhookEndpoint.id, input.id), eq(webhookEndpoint.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "api.webhook.delete", subjectType: "webhook_endpoint", subjectId: input.id, meta: { host: new URL(row!.url).host } }),
      ]);
      return { id: input.id };
    }),

    /** The latest deliveries of one webhook (newest first), with failures and their reason. */
    deliveries: apiProcedure
      .input(idInput.extend({ status: z.enum(["pending", "delivered", "failed"]).optional() }))
      .query(async ({ ctx, input }) => {
        const owned = await ctx.db
          .select({ id: webhookEndpoint.id })
          .from(webhookEndpoint)
          .where(and(eq(webhookEndpoint.id, input.id), eq(webhookEndpoint.companyId, ctx.companyId)))
          .get();
        if (!owned) notFound();
        const items = await ctx.db
          .select({
            id: webhookDelivery.id,
            event: webhookDelivery.event,
            status: webhookDelivery.status,
            attempts: webhookDelivery.attempts,
            lastStatus: webhookDelivery.lastStatus,
            lastError: webhookDelivery.lastError,
            nextAttemptAt: webhookDelivery.nextAttemptAt,
            deliveredAt: webhookDelivery.deliveredAt,
            createdAt: webhookDelivery.createdAt,
          })
          .from(webhookDelivery)
          .where(
            and(
              eq(webhookDelivery.companyId, ctx.companyId),
              eq(webhookDelivery.endpointId, input.id),
              input.status ? eq(webhookDelivery.status, input.status) : undefined,
            ),
          )
          .orderBy(desc(webhookDelivery.createdAt))
          .limit(50);
        return { items };
      }),

    /** Send a failed delivery again: a fresh 24 h window of retries from now. */
    resend: apiProcedure.input(idInput).mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: webhookDelivery.id, status: webhookDelivery.status, event: webhookDelivery.event, endpointId: webhookDelivery.endpointId })
        .from(webhookDelivery)
        .where(and(eq(webhookDelivery.id, input.id), eq(webhookDelivery.companyId, ctx.companyId)))
        .get();
      if (!row) notFound();
      if (row!.status !== "failed") return { id: input.id, status: row!.status };
      const at = now();
      await atomicBatch(ctx.db, [
        ctx.db
          .update(webhookDelivery)
          .set({ status: "pending", attempts: 0, nextAttemptAt: at, createdAt: at, claimedUntil: null, lastError: null, lastStatus: null })
          .where(and(eq(webhookDelivery.id, input.id), eq(webhookDelivery.companyId, ctx.companyId), eq(webhookDelivery.status, "failed"))),
        auditInsert(ctx, { action: "api.webhook.resend", subjectType: "webhook_delivery", subjectId: input.id, meta: { event: row!.event, endpointId: row!.endpointId } }),
      ]);
      scheduleDrain(ctx);
      return { id: input.id, status: "pending" as const };
    }),
  }),
});
