/**
 * Die share links (FP-DR-20), mounted as `die.share`. A die room user (die.card) or a masters
 * holder (masters.publish) sends ONE section's press drawing to a party as a link that expires
 * (7 days by default, 30 at most) and can be revoked. The token is shown once; only its hash is
 * stored. `view` is the one public procedure: no session, rate limited, and it shows only the
 * section number, the drawing (a signed URL minted per view, 10 minutes), the band and tier, and the
 * owner when the link was made for that owner. Never costs, stock, customers or other copies' data.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { company } from "@orrn/db/schema";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieBand, dieFile, dieInstance, dieShare } from "@orrn/db/schema/dies";
import { user } from "@orrn/db/schema/auth";

import { anyActionProcedure, publicProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { auditCtx, customerNames, decodeListCursor, encodeListCursor, listCursorInput, loadSection } from "../lib/dieRoom";
import { signDieFileUrl } from "../lib/dieFiles";
import {
  hashShareToken,
  limitShareIp,
  limitShareLink,
  looksLikeShareToken,
  newShareToken,
  SHARE_DEFAULT_DAYS,
  SHARE_GONE,
  SHARE_MAX_DAYS,
  shareExpiry,
} from "../lib/dieShare";
import { createId } from "../lib/id";
import { webBaseUrl } from "../lib/webUrl";

/** Who may send a drawing out: the die room (die.card) or masters holders, like the file editors. */
const shareEditorProcedure = anyActionProcedure("die.card", "masters.publish");

const gone = () => new TRPCError({ code: "NOT_FOUND", message: SHARE_GONE });

/** Where a share stands now. */
function shareStatus(row: { revokedAt: Date | null; expiresAt: Date }, nowMs: number): "active" | "expired" | "revoked" {
  if (row.revokedAt) return "revoked";
  return row.expiresAt.getTime() <= nowMs ? "expired" : "active";
}

export const dieShareRouter = router({
  /**
   * Make a link for one section's press drawing. `customerId` is the party it is for; a section owned
   * by a customer can only be shared with that owner, a plant-owned one with anyone (or no named
   * party). The token comes back once and is never stored.
   */
  create: shareEditorProcedure
    .input(
      z.object({
        sectionId: z.string().min(1),
        customerId: z.string().min(1).optional(),
        days: z.number().int().min(1).max(SHARE_MAX_DAYS).default(SHARE_DEFAULT_DAYS),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const section = await loadSection(ctx.db, ctx.companyId, input.sectionId);
      let party: { id: string; name: string } | null = null;
      if (input.customerId) {
        const [row] = await ctx.db
          .select({ id: customer.id, name: customer.name })
          .from(customer)
          .where(and(eq(customer.id, input.customerId), eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)))
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        party = row;
      }
      if (section.ownerCustomerId && section.ownerCustomerId !== party?.id) {
        const names = await customerNames(ctx.db, ctx.companyId, [section.ownerCustomerId]);
        throw new TRPCError({ code: "FORBIDDEN", message: `This die belongs to ${names.get(section.ownerCustomerId) ?? "another customer"}` });
      }
      if (!section.drawingKey) throw new TRPCError({ code: "BAD_REQUEST", message: "This section has no press drawing to share" });
      const [file] = await ctx.db
        .select({ id: dieFile.id, filename: dieFile.filename })
        .from(dieFile)
        .where(and(eq(dieFile.companyId, ctx.companyId), eq(dieFile.sectionId, section.id), eq(dieFile.r2Key, section.drawingKey)))
        .limit(1);

      const now = clockNow();
      const expiresAt = new Date(shareExpiry(now.getTime(), input.days));
      const token = newShareToken();
      const id = createId();
      await atomicBatch(ctx.db, [
        ctx.db.insert(dieShare).values({
          id,
          companyId: ctx.companyId,
          sectionId: section.id,
          customerId: party?.id ?? null,
          tokenHash: await hashShareToken(token),
          note: input.note || null,
          expiresAt,
          createdBy: ctx.session.user.id,
          createdAt: now,
        }),
        auditInsert(auditCtx(ctx), {
          action: "die_share.create",
          subjectType: "die",
          subjectId: section.id,
          meta: {
            shareId: id,
            section: `${section.series} ${section.sectionCode}`,
            customerId: party?.id ?? null,
            party: party?.name ?? null,
            fileId: file?.id ?? null,
            filename: file?.filename ?? null,
            days: input.days,
            expiresAt: expiresAt.getTime(),
            note: input.note || null,
          },
        }),
      ]);
      const path = `/share/die/${token}`;
      return { id, token, path, url: `${webBaseUrl()}${path}`, expiresAt };
    }),

  /** Links of one section, newest first (pages of `limit`). Never returns a token or its hash. */
  list: shareEditorProcedure
    .input(z.object({ sectionId: z.string().min(1), limit: z.number().int().min(1).max(100).default(30), cursor: listCursorInput }))
    .query(async ({ ctx, input }) => {
      await loadSection(ctx.db, ctx.companyId, input.sectionId, { includeDeleted: true });
      const after = decodeListCursor(input.cursor);
      const rows = await ctx.db
        .select({
          id: dieShare.id,
          customerId: dieShare.customerId,
          note: dieShare.note,
          expiresAt: dieShare.expiresAt,
          revokedAt: dieShare.revokedAt,
          viewCount: dieShare.viewCount,
          lastViewedAt: dieShare.lastViewedAt,
          createdAt: dieShare.createdAt,
          createdByName: user.name,
        })
        .from(dieShare)
        .leftJoin(user, eq(user.id, dieShare.createdBy))
        .where(
          and(
            eq(dieShare.companyId, ctx.companyId),
            eq(dieShare.sectionId, input.sectionId),
            after
              ? or(lt(dieShare.createdAt, new Date(after.at)), and(eq(dieShare.createdAt, new Date(after.at)), lt(dieShare.id, after.id)))
              : undefined,
          ),
        )
        .orderBy(desc(dieShare.createdAt), desc(dieShare.id))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const names = await customerNames(ctx.db, ctx.companyId, page.map((r) => r.customerId));
      const nowMs = clockNow().getTime();
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({ ...r, partyName: r.customerId ? (names.get(r.customerId) ?? null) : null, status: shareStatus(r, nowMs) })),
        nextCursor: rows.length > input.limit && last ? encodeListCursor(last.createdAt, last.id) : null,
      };
    }),

  /** Stop a link now. Revoking one already revoked answers success and writes no second audit row. */
  revoke: shareEditorProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ id: dieShare.id, sectionId: dieShare.sectionId, revokedAt: dieShare.revokedAt, customerId: dieShare.customerId })
      .from(dieShare)
      .where(and(eq(dieShare.id, input.id), eq(dieShare.companyId, ctx.companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Share link not found" });
    if (row.revokedAt) return { success: true, alreadyRevoked: true };
    const now = clockNow();
    const where = and(eq(dieShare.id, row.id), eq(dieShare.companyId, ctx.companyId), isNull(dieShare.revokedAt));
    await atomicBatch(ctx.db, [
      ctx.db.update(dieShare).set({ revokedAt: now, revokedBy: ctx.session.user.id }).where(where),
      // The audit row lands only when this call is the one that revoked it.
      auditInsertGuarded(
        auditCtx(ctx),
        { action: "die_share.revoke", subjectType: "die", subjectId: row.sectionId, meta: { shareId: row.id, customerId: row.customerId } },
        { from: dieShare, where: and(eq(dieShare.id, row.id), eq(dieShare.companyId, ctx.companyId), eq(dieShare.revokedBy, ctx.session.user.id), eq(dieShare.revokedAt, now)) },
      ),
    ]);
    return { success: true, alreadyRevoked: false };
  }),

  /**
   * PUBLIC (no session): what `/share/die/$token` shows. Unknown, revoked and expired links answer
   * the same NOT_FOUND "This link is no longer available". Limited per IP and per link. Returns the
   * section number, the drawing (a signed URL minted now, 10 minutes), the band(s) and best tier, and
   * the owner only when the link was made for that owner. No costs, stock, customers or copies.
   */
  view: publicProcedure.input(z.object({ token: z.string().min(1).max(200) })).mutation(async ({ ctx, input }) => {
    const nowMs = clockNow().getTime();
    await limitShareIp(ctx.db, ctx.request, nowMs);
    if (!looksLikeShareToken(input.token)) throw gone();
    const tokenHash = await hashShareToken(input.token);
    const [share] = await ctx.db
      .select()
      .from(dieShare)
      .innerJoin(company, and(eq(company.id, dieShare.companyId), eq(company.status, "active")))
      .where(eq(dieShare.tokenHash, tokenHash))
      .limit(1)
      .then((r) => r.map((x) => ({ ...x.die_share, companyName: x.company.name })));
    // Only a link that exists is counted per link (a guess leaves no row behind; the IP limit covers guesses).
    if (share) await limitShareLink(ctx.db, tokenHash, nowMs);
    if (!share || shareStatus(share, nowMs) !== "active") throw gone();

    // Every read below is scoped by the share's own company: the link is the only authority.
    const [section] = await ctx.db
      .select()
      .from(die)
      .where(and(eq(die.id, share.sectionId), eq(die.companyId, share.companyId), isNull(die.deletedAt)))
      .limit(1);
    if (!section) throw gone();

    const [bandRows, [tierRow], [file], owner] = await Promise.all([
      ctx.db
        .select({ wallTenthMm: dieBand.wallTenthMm, weightMinG: dieBand.weightMinG, weightMaxG: dieBand.weightMaxG, label: dieBand.label })
        .from(dieBand)
        .where(and(eq(dieBand.companyId, share.companyId), eq(dieBand.sectionId, section.id), eq(dieBand.active, true)))
        .orderBy(asc(dieBand.weightMinG), asc(dieBand.weightMaxG)),
      ctx.db
        .select({ tier: sql<number | null>`min(${dieInstance.tierRank})` })
        .from(dieInstance)
        .where(and(eq(dieInstance.companyId, share.companyId), eq(dieInstance.sectionId, section.id), sql`${dieInstance.status} <> 'retired'`)),
      section.drawingKey
        ? ctx.db
            .select({ filename: dieFile.filename })
            .from(dieFile)
            .where(and(eq(dieFile.companyId, share.companyId), eq(dieFile.sectionId, section.id), eq(dieFile.r2Key, section.drawingKey)))
            .limit(1)
        : Promise.resolve([] as { filename: string }[]),
      // The owner is named only to the party the link was made for.
      share.customerId && section.ownerCustomerId === share.customerId
        ? ctx.db
            .select({ name: customer.name })
            .from(customer)
            .where(and(eq(customer.id, share.customerId), eq(customer.companyId, share.companyId)))
            .limit(1)
            .then((r) => r[0]?.name ?? null)
        : Promise.resolve(null),
    ]);

    let drawing: { url: string; expiresAt: number; filename: string | null } | null = null;
    if (section.drawingKey) {
      try {
        const signed = await signDieFileUrl(ctx, share.companyId, section.drawingKey, nowMs);
        drawing = { url: signed.url, expiresAt: signed.expiresAt, filename: file?.filename ?? null };
      } catch {
        // No signing key or no bucket on this stage: the page says there is no drawing, never an error.
        drawing = null;
      }
    }

    await ctx.db
      .update(dieShare)
      .set({ viewCount: sql`${dieShare.viewCount} + 1`, lastViewedAt: new Date(nowMs) })
      .where(eq(dieShare.id, share.id));

    return {
      from: share.companyName,
      expiresAt: share.expiresAt,
      section: {
        series: section.series,
        sectionCode: section.sectionCode,
        name: section.name,
        alloy: section.alloy,
        temper: section.temper,
      },
      /** The section's own band (grams per 12 ft) first, then its other live bands. */
      bands: [
        { wallTenthMm: section.wallTenthMm ?? (section.thicknessMm != null ? Math.round(section.thicknessMm * 10) : null), weightMinG: section.weightMinG, weightMaxG: section.weightMaxG, label: null as string | null, primary: true },
        ...bandRows.map((b) => ({ ...b, primary: false })),
      ],
      tier: tierRow?.tier ?? null,
      owner,
      drawing,
    };
  }),
});
