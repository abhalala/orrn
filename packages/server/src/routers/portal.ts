/**
 * Customer portal (FP-PF-01..04, Wave 3; specs §E7 "Portal user", "Portal order", Rules, Procedures;
 * C29, C30, D6, D14, Q39). Mounted as `portal`.
 *
 * Party procedures run on `portalProcedure` (no company role, no `can()`): company and customer come
 * from the caller's `customer_portal_user` row, never from input. A miss is NOT_FOUND "Not found",
 * including a real row of another party or plant. The portal never carries a rate.
 *
 * Staff procedures (`portal.users.*`, `portal.sections.*`, `portal.certificates.*`) are on the plant
 * side: `portal.manage` (office, manager, admin; owner holds all).
 *
 * Sign-in path for a party (smallest safe path, D14 + PF §9-2): office grants -> an `invite` row of
 * kind `portal` (7 days) + the portal row `invited`; the party opens `/invite/{token}`, creates a
 * password account there (Better Auth email + password, the same path a member invite uses; the
 * public magic link still never creates an account) or signs in, and `invite.acceptByToken` turns
 * the row `active` without creating a membership. Later sign-ins are email + password; no TOTP is
 * asked of a party (PF §9-2).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { packingList } from "@orrn/db/schema/packing";
import { customerPortalSection, customerPortalUser, testCertificate } from "@orrn/db/schema/portal";
import { openSalesOrderStatuses, salesOrder, salesOrderStatuses, type SalesOrderStatus } from "@orrn/db/schema/sales";
import { company, invite, membership } from "@orrn/db/schema/tenant";

import { actionProcedure, anyActionProcedure, companyProcedure, portalProcedure, router, t } from "../index";
import { atomicBatch, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { nextDocNumber } from "../lib/docNumber";
import { renderOrrnEmailHtml, sendEmail } from "../lib/email";
import { assertModule } from "../lib/moduleGate";
import { lineBalances, lineTotals, orderTotals } from "../lib/orders";
import {
  assertSectionsVisible,
  listPortalAccess,
  portalNotFound,
  stripForParty,
  visibleSections,
  type PortalAccess,
} from "../lib/portal";
import { nextCompanySeq } from "../lib/sequence";
import { buildCertificateSnapshot } from "../lib/testCertificate";
import { webBaseUrl } from "../lib/webUrl";
import { createSalesOrder } from "./salesOrder";

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const blank = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());

/** Invite life (same as member invites). */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Most lines a party may book on one order (an office order takes 100). */
export const MAX_PORTAL_LINES = 20;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Portal order input (C29): section, cut length, pieces OR kg. Never a copy, tier or rate.
// ---------------------------------------------------------------------------

/** Keys a party may never send; present = BAD_REQUEST (not silently dropped). */
const RATE_KEYS = ["rate", "ratePaise", "ratePerKg", "price", "pricePaise"] as const;
const PLANT_ONLY_KEYS = ["dieInstanceId", "copyId", "tierRank", "weightBasis", "kgPer12ftMilli", "customerId", "status", "source"] as const;

const portalLineInput = z
  .object({
    sectionId: id,
    cutLengthMm: z.number().int().min(1).max(30_000),
    pcs: z.number().int().min(1).max(10_000_000).optional(),
    kgG: z.number().int().min(1).max(1_000_000_000).optional(),
    note: text(500).optional(),
  })
  .passthrough();

const portalOrderInput = z
  .object({
    poNumber: text(100).optional(),
    note: text(1000).optional(),
    lines: z.array(portalLineInput).min(1, "Add at least one line").max(MAX_PORTAL_LINES, `At most ${MAX_PORTAL_LINES} lines`),
    clientRequestId: z.string().trim().min(1).max(64).optional(),
  })
  .passthrough();

function refuseForbiddenKeys(obj: Record<string, unknown>, where: string) {
  for (const k of RATE_KEYS) {
    if (k in obj) throw new TRPCError({ code: "BAD_REQUEST", message: "The plant sets the rate. Send the order without a rate." });
  }
  for (const k of PLANT_ONLY_KEYS) {
    if (k in obj) throw new TRPCError({ code: "BAD_REQUEST", message: `${where}: the plant picks this (${k}). Leave it out.` });
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

type PortalCtx = { db: Parameters<typeof visibleSections>[0]; portal: PortalAccess };

/** A party's order header with totals (no rate, no copy, no tier). */
async function orderHeaders(ctx: PortalCtx, where: ReturnType<typeof and>, page: { limit: number; offset: number }) {
  const rows = await ctx.db
    .select({
      id: salesOrder.id,
      number: salesOrder.number,
      period: salesOrder.period,
      status: salesOrder.status,
      source: salesOrder.source,
      orderDate: salesOrder.orderDate,
      expectedDate: salesOrder.expectedDate,
      poNumber: salesOrder.poNumber,
      note: salesOrder.note,
      createdAt: salesOrder.createdAt,
    })
    .from(salesOrder)
    .where(where)
    .orderBy(desc(salesOrder.orderDate), desc(salesOrder.createdAt), desc(salesOrder.id))
    .limit(page.limit + 1)
    .offset(page.offset);
  const more = rows.length > page.limit;
  const items = more ? rows.slice(0, page.limit) : rows;
  const totals = await orderTotals(ctx.db, ctx.portal.companyId, items.map((o) => o.id));
  return {
    items: items.map((o) => {
      const tt = totals.get(o.id);
      return {
        ...o,
        totals: {
          lines: tt?.lines ?? 0,
          orderedG: tt?.orderedG ?? 0,
          dispatchedG: tt?.dispatchedG ?? 0,
          bakiG: tt?.bakiG ?? 0,
        },
      };
    }),
    nextOffset: more ? page.offset + page.limit : null,
  };
}

/** The party's completed, live dispatch, or NOT_FOUND. */
async function partyDispatch(ctx: PortalCtx, dispatchId: string) {
  const [row] = await ctx.db
    .select()
    .from(dispatch)
    .where(
      and(
        eq(dispatch.id, dispatchId),
        eq(dispatch.companyId, ctx.portal.companyId),
        eq(dispatch.customerId, ctx.portal.customerId),
        eq(dispatch.status, "completed"),
        isNull(dispatch.deletedAt),
      ),
    )
    .limit(1);
  if (!row) portalNotFound();
  return row;
}

/** Current packing list revision of a dispatch (the dispatch's own PL number wins over a combined one). */
async function currentPackingList(db: PortalCtx["db"], companyId: string, d: { id: string }) {
  const [pl] = await db
    .select()
    .from(packingList)
    .where(
      and(
        eq(packingList.dispatchId, d.id),
        eq(packingList.companyId, companyId),
        sql`not exists (select 1 from packing_list pn where pn.company_id = ${companyId} and pn.supersedes_id = ${packingList.id})`,
      ),
    )
    .orderBy(
      sql`${packingList.code} = (select dd.pl_number from dispatch dd where dd.id = ${d.id} and dd.company_id = ${companyId}) desc`,
      desc(packingList.revision),
    )
    .limit(1);
  return pl ?? null;
}

async function latestCertificate(db: PortalCtx["db"], companyId: string, dispatchId: string) {
  const [row] = await db
    .select()
    .from(testCertificate)
    .where(and(eq(testCertificate.companyId, companyId), eq(testCertificate.dispatchId, dispatchId)))
    .orderBy(desc(testCertificate.revision))
    .limit(1);
  return row ?? null;
}

/** Outer `dispatch` columns, qualified (drizzle drops the table name in a one-table select). */
const DISPATCH_COMPANY = sql.raw(`"dispatch"."company_id"`);
const DISPATCH_ID = sql.raw(`"dispatch"."id"`);

const pageInput = { limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) };

// ---------------------------------------------------------------------------
// Staff: portal users (grant / revoke)
// ---------------------------------------------------------------------------

const usersRouter = router({
  /** Party logins of this plant (Team tab second list): party, email, status, dates. */
  list: actionProcedure("portal.manage")
    .input(z.object({ customerId: id.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: customerPortalUser.id,
          customerId: customerPortalUser.customerId,
          customerName: customer.name,
          email: customerPortalUser.email,
          status: customerPortalUser.status,
          invitedAt: customerPortalUser.invitedAt,
          acceptedAt: customerPortalUser.acceptedAt,
          revokedAt: customerPortalUser.revokedAt,
          inviteExpiresAt: invite.expiresAt,
        })
        .from(customerPortalUser)
        .innerJoin(customer, and(eq(customer.id, customerPortalUser.customerId), eq(customer.companyId, ctx.companyId)))
        .leftJoin(invite, and(eq(invite.id, customerPortalUser.inviteId), eq(invite.companyId, ctx.companyId)))
        .where(
          and(
            eq(customerPortalUser.companyId, ctx.companyId),
            input?.customerId ? eq(customerPortalUser.customerId, input.customerId) : undefined,
          ),
        )
        .orderBy(asc(customer.name), asc(customerPortalUser.email))
        .limit(500);
      return rows;
    }),

  /**
   * Give a party a login (Invited, or straight back to Active for a revoked login that already has
   * its account). Refuses: portal off, unknown customer, an email that is a plant login here or has
   * a pending member invite here, an email already live for another party.
   * Returns the invite link too, so the office can pass it on when email does not arrive.
   */
  grant: actionProcedure("portal.manage")
    .input(z.object({ customerId: id, email: z.string().trim().max(320).email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const [co] = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).limit(1);
      if (!(co?.settings as Record<string, unknown> | undefined)?.portalEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Turn on the party portal in Settings first" });
      }
      const [cust] = await ctx.db
        .select({ id: customer.id, name: customer.name })
        .from(customer)
        .where(and(eq(customer.id, input.customerId), eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)))
        .limit(1);
      if (!cust) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });

      // PF §9-12: one email is never both staff and party in a plant.
      const [existingUser] = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = ${email}`)
        .limit(1);
      if (existingUser) {
        const [m] = await ctx.db
          .select({ id: membership.id })
          .from(membership)
          .where(and(eq(membership.userId, existingUser.id), eq(membership.companyId, ctx.companyId)))
          .limit(1);
        if (m) throw new TRPCError({ code: "BAD_REQUEST", message: "This email is a plant login here. Use another email for the party." });
      }
      const [memberInvite] = await ctx.db
        .select({ id: invite.id })
        .from(invite)
        .where(
          and(
            eq(invite.companyId, ctx.companyId),
            eq(invite.kind, "member"),
            sql`lower(${invite.email}) = ${email}`,
            isNull(invite.acceptedAt),
            isNull(invite.revokedAt),
            sql`${invite.expiresAt} > ${Date.now()}`,
          ),
        )
        .limit(1);
      if (memberInvite) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This email has a plant invite here. Revoke it first or use another email." });
      }

      const [row] = await ctx.db
        .select()
        .from(customerPortalUser)
        .where(and(eq(customerPortalUser.companyId, ctx.companyId), eq(customerPortalUser.email, email)))
        .limit(1);
      if (row && row.status !== "revoked" && row.customerId !== input.customerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This email already signs in for another party" });
      }
      if (row && row.status === "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This login is already active" });
      }

      const at = clockNow();
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [];
      // Revoked login that has its account: straight back to active (state machine Revoked -> Active).
      if (row && row.status === "revoked" && row.userId) {
        statements.push(
          ctx.db
            .update(customerPortalUser)
            .set({ status: "active", customerId: input.customerId, revokedAt: null, revokedBy: null, serverSeq: seq, updatedAt: at })
            .where(and(eq(customerPortalUser.id, row.id), eq(customerPortalUser.companyId, ctx.companyId), eq(customerPortalUser.status, "revoked"))),
          auditInsert(ctx, {
            action: "portal.user.grant",
            subjectType: "customer_portal_user",
            subjectId: row.id,
            meta: { customerId: input.customerId, email, status: "active", regrant: true },
          }),
        );
        await atomicBatch(ctx.db, statements);
        return { id: row.id, status: "active" as const, inviteUrl: null };
      }

      // Invited: a fresh invite (an earlier pending one is revoked so only the newest link works).
      const token = crypto.randomUUID();
      const tokenHash = await sha256Hex(token);
      const inviteId = crypto.randomUUID();
      const portalUserId = row?.id ?? crypto.randomUUID();
      if (row?.inviteId) {
        statements.push(
          ctx.db
            .update(invite)
            .set({ revokedAt: at })
            .where(and(eq(invite.id, row.inviteId), eq(invite.companyId, ctx.companyId), isNull(invite.acceptedAt), isNull(invite.revokedAt))),
        );
      }
      statements.push(
        ctx.db.insert(invite).values({
          id: inviteId,
          companyId: ctx.companyId,
          email,
          // Non-null placeholder only (platform spec §3); acceptance branches on kind and never makes a membership.
          role: "viewer",
          kind: "portal",
          customerId: input.customerId,
          tokenHash,
          // Wall clock, as invite.create and acceptByToken use (not the test clock).
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedBy: userId,
        }),
      );
      if (row) {
        statements.push(
          ctx.db
            .update(customerPortalUser)
            .set({
              status: "invited",
              customerId: input.customerId,
              inviteId,
              invitedAt: at,
              invitedBy: userId,
              revokedAt: null,
              revokedBy: null,
              serverSeq: seq,
              updatedAt: at,
            })
            .where(and(eq(customerPortalUser.id, row.id), eq(customerPortalUser.companyId, ctx.companyId), eq(customerPortalUser.status, row.status))),
        );
      } else {
        statements.push(
          ctx.db.insert(customerPortalUser).values({
            id: portalUserId,
            companyId: ctx.companyId,
            serverSeq: seq,
            customerId: input.customerId,
            email,
            userId: null,
            status: "invited",
            inviteId,
            invitedAt: at,
            invitedBy: userId,
            createdAt: at,
            updatedAt: at,
          }),
        );
      }
      statements.push(
        auditInsert(ctx, {
          action: "portal.user.grant",
          subjectType: "customer_portal_user",
          subjectId: portalUserId,
          meta: { customerId: input.customerId, email, status: "invited", ...(row ? { resent: true } : {}) },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (/UNIQUE constraint failed: customer_portal_user/.test(String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message ?? ""))) {
          throw new TRPCError({ code: "CONFLICT", message: "This email was just given a login. Reload and check the list." });
        }
        throw e;
      }

      const inviteUrl = `${webBaseUrl()}/invite/${token}`;
      try {
        await sendEmail({
          to: email,
          subject: `${cust.name}: your ORRN party login`,
          html: renderOrrnEmailHtml({
            title: "Party portal invitation",
            description: `You can now see your dies, orders and dispatches for ${cust.name}. Open the link to set your password and sign in.`,
            buttonText: "Open the invitation",
            buttonUrl: inviteUrl,
            footerText: "If you did not expect this email, you can ignore it. The link works for 7 days.",
          }),
        });
      } catch {
        // The login stands; the office copies the link from the answer (prod email is unreliable).
      }
      return { id: portalUserId, status: "invited" as const, inviteUrl };
    }),

  /** Revoke a login (invited or active). Its next portal call is FORBIDDEN; a pending invite dies. */
  revoke: actionProcedure("portal.manage")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(customerPortalUser)
        .where(and(eq(customerPortalUser.id, input.id), eq(customerPortalUser.companyId, ctx.companyId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Portal login not found" });
      if (row.status === "revoked") throw new TRPCError({ code: "BAD_REQUEST", message: "This login is already revoked" });
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(customerPortalUser)
          .set({ status: "revoked", revokedAt: at, revokedBy: ctx.session.user.id, serverSeq: seq, updatedAt: at })
          .where(and(eq(customerPortalUser.id, row.id), eq(customerPortalUser.companyId, ctx.companyId), eq(customerPortalUser.status, row.status))),
      ];
      if (row.inviteId) {
        statements.push(
          ctx.db
            .update(invite)
            .set({ revokedAt: at })
            .where(and(eq(invite.id, row.inviteId), eq(invite.companyId, ctx.companyId), isNull(invite.acceptedAt), isNull(invite.revokedAt))),
        );
      }
      statements.push(
        auditInsert(ctx, {
          action: "portal.user.revoke",
          subjectType: "customer_portal_user",
          subjectId: row.id,
          meta: { customerId: row.customerId, email: row.email, from: row.status },
        }),
      );
      await atomicBatch(ctx.db, statements);
      return { id: row.id, status: "revoked" as const };
    }),
});

// ---------------------------------------------------------------------------
// Staff: section grants
// ---------------------------------------------------------------------------

const sectionsRouter = router({
  /**
   * PARTY: sections and copies the visibility rule allows (`/portal/dies`). Copies carry the oblique
   * code, latest kg/12 ft and the band only when die bands are on. (Spec "portal.sections"; it sits
   * here because `portal.sections.grant/revoke` share the namespace.)
   */
  visible: portalProcedure.query(async ({ ctx }) => {
    const { sections, copies } = await visibleSections(ctx.db, ctx.portal);
    return sections.map((s) => ({
      ...s,
      copies: copies
        .filter((c) => c.sectionId === s.id)
        .map((c) => ({ id: c.id, code: c.code, latestKgPer12ftMilli: c.latestKgPer12ftMilli, band: c.band })),
    }));
  }),

  /** STAFF: live grants of one party, with section codes. */
  list: actionProcedure("portal.manage")
    .input(z.object({ customerId: id }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: customerPortalSection.id,
          dieId: customerPortalSection.dieId,
          series: die.series,
          sectionCode: die.sectionCode,
          name: die.name,
          ownerCustomerId: die.ownerCustomerId,
          grantedAt: customerPortalSection.grantedAt,
        })
        .from(customerPortalSection)
        .innerJoin(die, and(eq(die.id, customerPortalSection.dieId), eq(die.companyId, ctx.companyId)))
        .where(
          and(
            eq(customerPortalSection.companyId, ctx.companyId),
            eq(customerPortalSection.customerId, input.customerId),
            isNull(customerPortalSection.revokedAt),
          ),
        )
        .orderBy(asc(die.series), asc(die.sectionCode))
        .limit(500);
    }),

  /**
   * Let a party see and book a section. Not an owner override: a section another customer owns stays
   * hidden (`ownedByOther` warns the office), and copies other customers own stay hidden.
   */
  grant: actionProcedure("portal.manage")
    .input(z.object({ customerId: id, dieId: id }))
    .mutation(async ({ ctx, input }) => {
      const [cust] = await ctx.db
        .select({ id: customer.id })
        .from(customer)
        .where(and(eq(customer.id, input.customerId), eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)))
        .limit(1);
      if (!cust) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      const [sec] = await ctx.db
        .select({ id: die.id, sectionCode: die.sectionCode, ownerCustomerId: die.ownerCustomerId })
        .from(die)
        .where(and(eq(die.id, input.dieId), eq(die.companyId, ctx.companyId), isNull(die.deletedAt)))
        .limit(1);
      if (!sec) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });
      const grantId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(customerPortalSection).values({
            id: grantId,
            companyId: ctx.companyId,
            serverSeq: seq,
            customerId: input.customerId,
            dieId: input.dieId,
            grantedBy: ctx.session.user.id,
            grantedAt: clockNow(),
          }),
          auditInsert(ctx, {
            action: "portal.section.grant",
            subjectType: "customer_portal_section",
            subjectId: grantId,
            meta: { customerId: input.customerId, dieId: input.dieId, sectionCode: sec.sectionCode },
          }),
        ]);
      } catch (e) {
        const msg = `${(e as Error)?.message ?? ""} ${(e as { cause?: Error })?.cause?.message ?? ""}`;
        if (/UNIQUE constraint failed: customer_portal_section/.test(msg)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This party already sees this section" });
        }
        throw e;
      }
      return {
        id: grantId,
        ownedByOther: sec.ownerCustomerId != null && sec.ownerCustomerId !== input.customerId,
      };
    }),

  revoke: actionProcedure("portal.manage")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(customerPortalSection)
        .where(and(eq(customerPortalSection.id, input.id), eq(customerPortalSection.companyId, ctx.companyId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Grant not found" });
      if (row.revokedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This grant is already revoked" });
      const at = clockNow();
      await atomicBatch(ctx.db, [
        ctx.db
          .update(customerPortalSection)
          .set({ revokedAt: at, revokedBy: ctx.session.user.id })
          .where(and(eq(customerPortalSection.id, row.id), eq(customerPortalSection.companyId, ctx.companyId), isNull(customerPortalSection.revokedAt))),
        auditInsert(ctx, {
          action: "portal.section.revoke",
          subjectType: "customer_portal_section",
          subjectId: row.id,
          meta: { customerId: row.customerId, dieId: row.dieId },
        }),
      ]);
      return { id: row.id };
    }),
});

// ---------------------------------------------------------------------------
// Staff: test certificates (issue / read)
// ---------------------------------------------------------------------------

const certificatesRouter = router({
  /**
   * Issue (or re-issue as the next revision, same number) the party certificate of a completed
   * dispatch. Chemistry the foundry has not tested yet is marked pending, never invented.
   */
  issue: anyActionProcedure("portal.manage", "dispatch.complete")
    .input(z.object({ dispatchId: id }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select()
        .from(dispatch)
        .where(and(eq(dispatch.id, input.dispatchId), eq(dispatch.companyId, ctx.companyId), isNull(dispatch.deletedAt)))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      if (d.status !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a completed dispatch gets a test certificate" });
      }
      const prev = await latestCertificate(ctx.db, ctx.companyId, d.id);
      const at = clockNow();
      const userId = ctx.session.user.id;
      const { number, period } = prev
        ? { number: prev.number, period: prev.period }
        : await nextDocNumber(ctx.db, ctx.companyId, "cert", at, userId);
      const revision = (prev?.revision ?? 0) + 1;
      const snapshot = await buildCertificateSnapshot(ctx.db, ctx.companyId, d, { number, revision, at });
      const pl = await currentPackingList(ctx.db, ctx.companyId, d);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const certId = crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(testCertificate).values({
            id: certId,
            companyId: ctx.companyId,
            serverSeq: seq,
            dispatchId: d.id,
            customerId: d.customerId,
            packingListId: pl?.id ?? null,
            period,
            number,
            revision,
            supersedesId: prev?.id ?? null,
            chemistry: snapshot.chemistry.status,
            snapshot: snapshot as unknown as Record<string, unknown>,
            createdBy: userId,
            createdAt: at,
          }),
          auditInsert(ctx, {
            action: "portal.certificate.issue",
            subjectType: "test_certificate",
            subjectId: certId,
            meta: { dispatchId: d.id, number, revision, chemistry: snapshot.chemistry.status },
          }),
        ]);
      } catch (e) {
        const msg = `${(e as Error)?.message ?? ""} ${(e as { cause?: Error })?.cause?.message ?? ""}`;
        if (/UNIQUE constraint failed: test_certificate/.test(msg)) {
          throw new TRPCError({ code: "CONFLICT", message: "This certificate was just issued. Reload." });
        }
        throw e;
      }
      return { id: certId, number, revision, chemistry: snapshot.chemistry.status };
    }),

  /** Latest certificate of a dispatch for the staff screen (null when none yet). */
  forDispatch: companyProcedure.input(z.object({ dispatchId: id })).query(async ({ ctx, input }) => {
    const row = await latestCertificate(ctx.db, ctx.companyId, input.dispatchId);
    return row
      ? { id: row.id, number: row.number, revision: row.revision, chemistry: row.chemistry, createdAt: row.createdAt, snapshot: row.snapshot }
      : null;
  }),
});

// ---------------------------------------------------------------------------
// Party procedures
// ---------------------------------------------------------------------------

/** The session user's portal plants (authed, no portal row needed): the client routes on it. */
const accessProcedure = t.procedure.query(async ({ ctx }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  const rows = await listPortalAccess(ctx.db, ctx.session.user.id);
  return rows.map((r) => ({
    companyId: r.companyId,
    companyName: r.companyName,
    customerName: r.customerName,
    portalEnabled: r.floor.portalEnabled,
  }));
});

export const portalRouter = router({
  access: accessProcedure,

  /** Who I am in the portal: party, plant, locale, visible sections, my other portal plants. */
  me: portalProcedure.query(async ({ ctx }) => {
    const { sections } = await visibleSections(ctx.db, ctx.portal);
    const plants = await listPortalAccess(ctx.db, ctx.session.user.id);
    return {
      user: { id: ctx.session.user.id, name: ctx.session.user.name, email: ctx.session.user.email },
      customer: { id: ctx.portal.customerId, name: ctx.portal.customerName },
      company: { id: ctx.portal.companyId, name: ctx.portal.companyName },
      locale: ctx.portal.floor.locale,
      dieBands: ctx.portal.floor.dieBands,
      lengthUnit: ctx.portal.settings.lengthUnit === "inch" ? ("inch" as const) : ("mm" as const),
      /** Calendar zone for the dates a party reads (packing list date, order dates). */
      timeZone: typeof ctx.portal.settings.timezone === "string" && ctx.portal.settings.timezone ? ctx.portal.settings.timezone : "Asia/Kolkata",
      sections: sections.map((s) => ({ id: s.id, series: s.series, sectionCode: s.sectionCode, name: s.name })),
      plants: plants.map((p) => ({ companyId: p.companyId, companyName: p.companyName, customerName: p.customerName })),
    };
  }),

  orders: router({
    /** This party's orders, newest first: status, ordered / dispatched / baki kg. No rate. */
    list: portalProcedure
      .input(z.object({ status: z.enum(["open", "all", ...salesOrderStatuses]).default("all"), ...pageInput }).optional())
      .query(async ({ ctx, input }) => {
        const status = input?.status ?? "all";
        const statuses: readonly SalesOrderStatus[] | null =
          status === "all" ? null : status === "open" ? openSalesOrderStatuses : [status];
        return orderHeaders(
          ctx,
          and(
            eq(salesOrder.companyId, ctx.portal.companyId),
            eq(salesOrder.customerId, ctx.portal.customerId),
            statuses ? inArray(salesOrder.status, [...statuses]) : undefined,
          ),
          { limit: input?.limit ?? 20, offset: input?.offset ?? 0 },
        );
      }),

    /** One order of this party with its lines (section, cut, pcs, ordered / dispatched / baki). */
    get: portalProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
      const where = and(
        eq(salesOrder.id, input.id),
        eq(salesOrder.companyId, ctx.portal.companyId),
        eq(salesOrder.customerId, ctx.portal.customerId),
      );
      const { items } = await orderHeaders(ctx, where, { limit: 1, offset: 0 });
      const order = items[0];
      if (!order) portalNotFound();
      const lines = await lineBalances(ctx.db, ctx.portal.companyId, { orderId: order.id });
      return {
        ...order,
        lines: lines.map((l) => ({
          lineNo: l.lineNo,
          sectionId: l.sectionId,
          sectionCode: l.sectionCode,
          series: l.series,
          sectionName: l.sectionName,
          cutLengthMm: l.cutLengthMm,
          finish: l.finish,
          note: l.note,
          orderedG: l.orderedG,
          orderedPcs: l.orderedPcs,
          dispatchedG: l.dispatchedG,
          dispatchedPcs: l.dispatchedPcs,
          bakiG: l.bakiG,
          bakiPcs: l.bakiPcs,
        })),
      };
    }),

    /**
     * Book an order (C29): `orders.create` with source portal, status booking, customer fixed, no
     * copy / tier / rate. Each line names a section the party may see (else Not found). Pieces OR kg;
     * the server computes the other side on the section's band start (a hidden copy's weight never
     * shapes a party's order). The office confirms (`orders.confirm`) or rejects (`orders.cancel`).
     */
    create: portalProcedure.input(portalOrderInput).mutation(async ({ ctx, input }) => {
      refuseForbiddenKeys(input as Record<string, unknown>, "Order");
      input.lines.forEach((l, i) => refuseForbiddenKeys(l as Record<string, unknown>, `Line ${i + 1}`));
      await assertModule({ db: ctx.db, companyId: ctx.portal.companyId }, "orders");
      await assertSectionsVisible(ctx.db, ctx.portal, input.lines.map((l) => l.sectionId));
      const lines = input.lines.map((l, i) => {
        if (l.pcs == null && l.kgG == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Line ${i + 1}: enter pieces or kg` });
        }
        return {
          sectionId: l.sectionId,
          cutLengthMm: l.cutLengthMm,
          ...(l.pcs != null ? { pcs: l.pcs, qtyBasis: "pcs" as const } : { kgG: l.kgG, qtyBasis: "kg" as const }),
          weightBasis: "band_start" as const,
          note: blank(l.note),
        };
      });
      const result = await createSalesOrder(
        {
          db: ctx.db,
          companyId: ctx.portal.companyId,
          session: ctx.session,
          impersonation: null,
        },
        {
          customerId: ctx.portal.customerId,
          poNumber: blank(input.poNumber),
          note: blank(input.note),
          status: "booking",
          lines,
          // Namespaced per portal login: a party's key can never match another party's or the office's.
          ...(input.clientRequestId ? { clientRequestId: `portal:${ctx.portal.portalUserId}:${input.clientRequestId}` } : {}),
        },
        { canPrice: false, source: "portal" },
      );
      return { id: result.id, number: result.number, status: "booking" as const, replayed: result.replayed };
    }),
  }),

  dispatches: router({
    /** Completed dispatches of this party (draft and held are hidden), newest first. */
    list: portalProcedure.input(z.object(pageInput).optional()).query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      const rows = await ctx.db
        .select({
          id: dispatch.id,
          code: dispatch.code,
          completedAt: dispatch.completedAt,
          shipDate: dispatch.shipDate,
          plNumber: dispatch.plNumber,
          vehicleNo: dispatch.vehicleNo,
          bundles: sql<number>`(select count(*) from dispatch_item di where di.company_id = ${DISPATCH_COMPANY} and di.dispatch_id = ${DISPATCH_ID})`,
          weightG: sql<number>`(select coalesce(sum(b.weight_g), 0) from dispatch_item di join bundle b on b.id = di.bundle_id and b.company_id = di.company_id where di.company_id = ${DISPATCH_COMPANY} and di.dispatch_id = ${DISPATCH_ID})`,
          pcs: sql<number>`(select coalesce(sum(b.quantity), 0) from dispatch_item di join bundle b on b.id = di.bundle_id and b.company_id = di.company_id where di.company_id = ${DISPATCH_COMPANY} and di.dispatch_id = ${DISPATCH_ID})`,
          hasPackingList: sql<number>`exists (select 1 from packing_list p where p.company_id = ${DISPATCH_COMPANY} and p.dispatch_id = ${DISPATCH_ID})`,
          hasCertificate: sql<number>`exists (select 1 from test_certificate c where c.company_id = ${DISPATCH_COMPANY} and c.dispatch_id = ${DISPATCH_ID})`,
        })
        .from(dispatch)
        .where(
          and(
            eq(dispatch.companyId, ctx.portal.companyId),
            eq(dispatch.customerId, ctx.portal.customerId),
            eq(dispatch.status, "completed"),
            isNull(dispatch.deletedAt),
          ),
        )
        .orderBy(desc(dispatch.completedAt), desc(dispatch.id))
        .limit(limit + 1)
        .offset(offset);
      const more = rows.length > limit;
      return {
        items: (more ? rows.slice(0, limit) : rows).map((r) => ({
          ...r,
          bundles: Number(r.bundles),
          weightG: Number(r.weightG),
          pcs: Number(r.pcs),
          hasPackingList: Boolean(Number(r.hasPackingList)),
          hasCertificate: Boolean(Number(r.hasCertificate)),
        })),
        nextOffset: more ? offset + limit : null,
      };
    }),

    /** One completed dispatch of this party with its bundles (no cast, no plant serial internals beyond the printed number). */
    get: portalProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
      const d = await partyDispatch(ctx, input.id);
      const bundles = await ctx.db
        .select({
          bundleNo: bundle.serial,
          partyNo: bundle.partyNo,
          sectionCode: die.sectionCode,
          series: die.series,
          pcs: bundle.quantity,
          weightG: bundle.weightG,
          lengthMm: bundle.lengthMm,
        })
        .from(dispatchItem)
        .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, ctx.portal.companyId)))
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, ctx.portal.companyId)))
        .where(and(eq(dispatchItem.dispatchId, d.id), eq(dispatchItem.companyId, ctx.portal.companyId)))
        .orderBy(asc(die.sectionCode), asc(bundle.serial))
        .limit(1000);
      const pl = await currentPackingList(ctx.db, ctx.portal.companyId, d);
      const cert = await latestCertificate(ctx.db, ctx.portal.companyId, d.id);
      return {
        id: d.id,
        code: d.code,
        completedAt: d.completedAt,
        shipDate: d.shipDate,
        plNumber: d.plNumber,
        vehicleNo: d.vehicleNo,
        bundles,
        totals: {
          bundles: bundles.length,
          pcs: bundles.reduce((s, b) => s + b.pcs, 0),
          weightG: bundles.reduce((s, b) => s + b.weightG, 0),
        },
        hasPackingList: Boolean(pl),
        hasCertificate: Boolean(cert),
      };
    }),
  }),

  packingList: router({
    /** The current packing list snapshot of this party's completed dispatch; no cast numbers (Q39), no author id. */
    get: portalProcedure.input(z.object({ dispatchId: id })).query(async ({ ctx, input }) => {
      const d = await partyDispatch(ctx, input.dispatchId);
      const pl = await currentPackingList(ctx.db, ctx.portal.companyId, d);
      if (!pl) portalNotFound();
      return {
        id: pl.id,
        code: pl.code,
        revision: pl.revision,
        createdAt: pl.createdAt,
        snapshot: stripForParty(pl.snapshot) as Record<string, unknown>,
      };
    }),
  }),

  certificate: router({
    /** Latest certificate revision of this party's completed dispatch, or Not found. */
    get: portalProcedure.input(z.object({ dispatchId: id })).query(async ({ ctx, input }) => {
      const d = await partyDispatch(ctx, input.dispatchId);
      const cert = await latestCertificate(ctx.db, ctx.portal.companyId, d.id);
      if (!cert) portalNotFound();
      return {
        id: cert.id,
        number: cert.number,
        revision: cert.revision,
        chemistry: cert.chemistry,
        createdAt: cert.createdAt,
        // The certificate cites casts and per-cast chemistry (D28); the packing list never does.
        snapshot: stripForParty(cert.snapshot, { keepCasts: true }) as Record<string, unknown>,
      };
    }),
  }),

  /** The party's home: open orders, baki kg, last completed dispatch. No plant KPIs, no rate. */
  today: portalProcedure.query(async ({ ctx }) => {
    const [open] = await ctx.db
      .select({ n: count() })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.companyId, ctx.portal.companyId),
          eq(salesOrder.customerId, ctx.portal.customerId),
          inArray(salesOrder.status, [...openSalesOrderStatuses]),
        ),
      );
    const baki = await lineTotals(ctx.db, ctx.portal.companyId, { customerId: ctx.portal.customerId, openOnly: true });
    const [last] = await ctx.db
      .select({ id: dispatch.id, code: dispatch.code, completedAt: dispatch.completedAt })
      .from(dispatch)
      .where(
        and(
          eq(dispatch.companyId, ctx.portal.companyId),
          eq(dispatch.customerId, ctx.portal.customerId),
          eq(dispatch.status, "completed"),
          isNull(dispatch.deletedAt),
        ),
      )
      .orderBy(desc(dispatch.completedAt), desc(dispatch.id))
      .limit(1);
    const { sections } = await visibleSections(ctx.db, ctx.portal);
    return {
      customer: { name: ctx.portal.customerName },
      openOrders: open?.n ?? 0,
      bakiG: baki.bakiG,
      lastDispatch: last ?? null,
      canOrder: sections.length > 0,
    };
  }),

  users: usersRouter,
  sections: sectionsRouter,
  certificates: certificatesRouter,
});
