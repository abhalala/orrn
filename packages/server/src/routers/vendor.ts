/**
 * Scrap vendors (spec P14, digest §3.1): name, GSTIN (or unregistered), aliases, merge.
 *
 * - Lookup is by `nameKey` (letters and digits, lower case) of the name and of every alias; one
 *   key resolves to one live vendor. Brokers ("K" in a party name) are not vendors.
 * - masters.publish (manager, admin, owner) creates confirmed vendors and edits them; yard staff
 *   at the kanta (purchase.receipt) and masters.draft holders may create one inline, which starts
 *   as `draft` until a masters.publish holder confirms it. Lots may use a draft vendor.
 * - `merge` folds duplicates into one: their lots and aliases move to the keeper and their names
 *   become aliases there; the merged rows stay (status merged, merged_into_id) for history.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { purchaseLot, vendor, vendorAlias, vendorStatuses } from "@orrn/db/schema/purchase";
import { company } from "@orrn/db/schema/tenant";

import { actionProcedure, anyActionProcedure, router } from "../index";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { can } from "../lib/permissions";
import { GSTIN_RE, nameKey } from "../lib/purchase";
import { nextCompanySeq } from "../lib/sequence";

const NOT_FOUND = { code: "NOT_FOUND", message: "Vendor not found" } as const;

/** Who may read vendors and purchase data (rates are commercial): yard, office, accounts, managers. */
export const purchaseReader = anyActionProcedure(
  "purchase.receipt",
  "purchase.dcnote",
  "reports.read",
  "masters.publish",
);

const vendorName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((s) => nameKey(s).length > 0, "Name needs letters or digits");
const gstin = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => GSTIN_RE.test(s), "Not a valid GSTIN");
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

type Ctx = { db: OrrnDb; companyId: string };

/** Live = can take lots and be looked up. */
const LIVE: ("draft" | "active")[] = ["draft", "active"];

function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

async function loadVendor(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(vendor)
    .where(and(eq(vendor.id, id), eq(vendor.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(NOT_FOUND);
  return row;
}

/** The live vendor (other than `exceptId`) whose name or alias already has `key`, if any. */
async function keyOwner(ctx: Ctx, key: string, exceptId?: string) {
  const [byName] = await ctx.db
    .select({ id: vendor.id, name: vendor.name })
    .from(vendor)
    .where(
      and(
        eq(vendor.companyId, ctx.companyId),
        eq(vendor.nameKey, key),
        ne(vendor.status, "merged"),
        exceptId ? ne(vendor.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (byName) return byName;
  const [byAlias] = await ctx.db
    .select({ id: vendor.id, name: vendor.name })
    .from(vendorAlias)
    .innerJoin(vendor, eq(vendor.id, vendorAlias.vendorId))
    .where(
      and(
        eq(vendorAlias.companyId, ctx.companyId),
        eq(vendorAlias.aliasKey, key),
        exceptId ? ne(vendorAlias.vendorId, exceptId) : undefined,
      ),
    )
    .limit(1);
  return byAlias ?? null;
}

function taken(name: string): TRPCError {
  return new TRPCError({ code: "CONFLICT", message: `That name is already used by ${name}` });
}

/** SQL: no live vendor of the company has `key` as its name (write-time guard for alias inserts). */
function noLiveNameKey(companyId: string, key: string, exceptId?: string): SQL {
  return sql`not exists (select 1 from ${vendor} v where v.company_id = ${companyId} and v.name_key = ${key} and v.status <> 'merged'${
    exceptId ? sql` and v.id <> ${exceptId}` : sql``
  })`;
}

/** SQL: no alias of the company has `key` (write-time guard for vendor inserts/renames). */
function noAliasKey(companyId: string, key: string, exceptVendorId?: string): SQL {
  return sql`not exists (select 1 from ${vendorAlias} a where a.company_id = ${companyId} and a.alias_key = ${key}${
    exceptVendorId ? sql` and a.vendor_id <> ${exceptVendorId}` : sql``
  })`;
}

/** INSERT … SELECT of one alias for a live vendor, landing only if no live vendor is named `key`. */
function aliasInsert(
  ctx: Ctx & { userId: string },
  input: { id: string; vendorId: string; alias: string; key: string; seq: number },
): SqliteBatchItem {
  const v = (c: string) => sql`${sql.identifier("vendor")}.${sql.identifier(c)}`;
  return ctx.db.insert(vendorAlias).select(
    ctx.db
      .select({
        id: sql<string>`${input.id}`.as("id"),
        companyId: sql<string>`${v("company_id")}`.as("company_id"),
        serverSeq: sql<number>`${input.seq}`.as("server_seq"),
        vendorId: sql<string>`${v("id")}`.as("vendor_id"),
        alias: sql<string>`${input.alias}`.as("alias"),
        aliasKey: sql<string>`${input.key}`.as("alias_key"),
        createdBy: sql<string>`${ctx.userId}`.as("created_by"),
        createdAt: sql<number>`${Date.now()}`.as("created_at"),
      })
      .from(vendor)
      .where(
        and(
          eq(vendor.id, input.vendorId),
          eq(vendor.companyId, ctx.companyId),
          notInArray(vendor.status, ["merged"]),
          noLiveNameKey(ctx.companyId, input.key, input.vendorId),
        ),
      ),
  );
}

export const vendorRouter = router({
  /** Vendors by name; `q` matches the name or any alias. Merged vendors only when asked for. */
  list: purchaseReader
    .input(
      z
        .object({
          q: z.string().trim().max(120).optional(),
          status: z.enum(vendorStatuses).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const key = input.q ? nameKey(input.q) : "";
      const where = and(
        eq(vendor.companyId, ctx.companyId),
        input.status ? eq(vendor.status, input.status) : ne(vendor.status, "merged"),
        key
          ? or(
              sql`${vendor.nameKey} like ${`%${key}%`}`,
              sql`exists (select 1 from ${vendorAlias} a where a.vendor_id = ${vendor.id} and a.company_id = ${vendor.companyId} and a.alias_key like ${`%${key}%`})`,
            )
          : undefined,
      );
      const [items, [totalRow]] = await Promise.all([
        ctx.db
          .select({
            id: vendor.id,
            companyId: vendor.companyId,
            name: vendor.name,
            gstin: vendor.gstin,
            phone: vendor.phone,
            city: vendor.city,
            status: vendor.status,
            mergedIntoId: vendor.mergedIntoId,
            aliasCount: sql<number>`(select count(*) from ${vendorAlias} a where a.vendor_id = ${vendor.id} and a.company_id = ${vendor.companyId})`,
            lastLotDate: sql<string | null>`(select max(l.lot_date) from ${purchaseLot} l where l.vendor_id = ${vendor.id} and l.company_id = ${vendor.companyId})`,
          })
          .from(vendor)
          .where(where)
          .orderBy(asc(vendor.name), asc(vendor.id))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ n: sql<number>`count(*)` }).from(vendor).where(where),
      ]);
      const total = Number(totalRow?.n ?? 0);
      const next = input.offset + items.length;
      return { items, total, limit: input.limit, offset: input.offset, nextOffset: next < total ? next : null };
    }),

  /** One vendor, its aliases, its usual items and last rates (from its recent lots). */
  get: purchaseReader.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const row = await loadVendor(ctx, input.id);
    const [aliases, recentLots] = await Promise.all([
      ctx.db
        .select({ id: vendorAlias.id, alias: vendorAlias.alias, createdAt: vendorAlias.createdAt })
        .from(vendorAlias)
        .where(and(eq(vendorAlias.companyId, ctx.companyId), eq(vendorAlias.vendorId, row.id)))
        .orderBy(asc(vendorAlias.alias)),
      ctx.db
        .select({
          id: purchaseLot.id,
          number: purchaseLot.number,
          lotDate: purchaseLot.lotDate,
          scrapItemId: purchaseLot.scrapItemId,
          scrapGradeId: purchaseLot.scrapGradeId,
          ratePaise: purchaseLot.ratePaise,
          status: purchaseLot.status,
        })
        .from(purchaseLot)
        .where(and(eq(purchaseLot.companyId, ctx.companyId), eq(purchaseLot.vendorId, row.id)))
        .orderBy(sql`${purchaseLot.lotDate} desc`, sql`${purchaseLot.createdAt} desc`)
        .limit(50),
    ]);
    // Usual items = most bought in the recent lots; last rate per item = the newest lot's rate.
    const byItem = new Map<string, { scrapItemId: string; lots: number; lastRatePaise: number; lastLotDate: string }>();
    for (const l of recentLots) {
      if (l.status === "cancelled") continue;
      const cur = byItem.get(l.scrapItemId);
      if (cur) cur.lots += 1;
      else byItem.set(l.scrapItemId, { scrapItemId: l.scrapItemId, lots: 1, lastRatePaise: l.ratePaise, lastLotDate: l.lotDate });
    }
    const usualItems = [...byItem.values()].sort((a, b) => b.lots - a.lots);
    return { vendor: row, aliases, usualItems, recentLots: recentLots.slice(0, 10) };
  }),

  /**
   * Resolve free text from a slip or the floor to a live vendor by name or alias key, else null.
   * A merged vendor's name is an alias of its keeper, so old spellings land on the keeper.
   */
  resolve: purchaseReader.input(z.object({ text: z.string().trim().min(1).max(200) })).query(async ({ ctx, input }) => {
    const key = nameKey(input.text);
    if (!key) return null;
    const owner = await keyOwner(ctx, key);
    if (!owner) return null;
    const [row] = await ctx.db
      .select({ id: vendor.id, name: vendor.name, status: vendor.status, gstin: vendor.gstin })
      .from(vendor)
      .where(and(eq(vendor.id, owner.id), eq(vendor.companyId, ctx.companyId), inArray(vendor.status, LIVE)))
      .limit(1);
    return row ?? null;
  }),

  /**
   * New vendor (optionally with aliases). masters.publish → active; otherwise (yard staff at the
   * kanta, masters.draft) → draft for a manager to confirm.
   */
  create: anyActionProcedure("masters.publish", "masters.draft", "purchase.receipt")
    .input(
      z.object({
        name: vendorName,
        gstin: gstin.nullable().optional(),
        phone: optText(40),
        city: optText(80),
        notes: optText(500),
        aliases: z.array(vendorName).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key = nameKey(input.name);
      const aliasList = [...new Map((input.aliases ?? []).map((a) => [nameKey(a), a.trim()])).entries()].filter(
        ([k]) => k !== key,
      );
      const keys = [key, ...aliasList.map(([k]) => k)];
      for (const k of keys) {
        const owner = await keyOwner(ctx, k);
        if (owner) throw taken(owner.name);
      }
      const publish = can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "masters.publish");
      const status = publish ? "active" : "draft";
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const statements: SqliteBatchItem[] = [
        // INSERT … SELECT so the "no alias has this key" check happens at write time.
        ctx.db.insert(vendor).select(
          ctx.db
            .select({
              id: sql<string>`${id}`.as("id"),
              companyId: sql<string>`${company.id}`.as("company_id"),
              serverSeq: sql<number>`${seq}`.as("server_seq"),
              name: sql<string>`${input.name}`.as("name"),
              nameKey: sql<string>`${key}`.as("name_key"),
              gstin: sql<string | null>`${input.gstin ?? null}`.as("gstin"),
              phone: sql<string | null>`${input.phone ?? null}`.as("phone"),
              city: sql<string | null>`${input.city ?? null}`.as("city"),
              status: sql<string>`${status}`.as("status"),
              mergedIntoId: sql<string | null>`null`.as("merged_into_id"),
              notes: sql<string | null>`${input.notes ?? null}`.as("notes"),
              createdBy: sql<string>`${userId}`.as("created_by"),
              createdAt: sql<number>`${Date.now()}`.as("created_at"),
              updatedAt: sql<number>`${Date.now()}`.as("updated_at"),
            })
            .from(company)
            .where(and(eq(company.id, ctx.companyId), noAliasKey(ctx.companyId, key))),
        ),
        ...aliasList.map(([k, alias]) =>
          aliasInsert({ ...ctx, userId }, { id: crypto.randomUUID(), vendorId: id, alias, key: k, seq }),
        ),
        auditInsertGuarded(
          ctx,
          {
            action: "vendor.create",
            subjectType: "vendor",
            subjectId: id,
            meta: { name: input.name, status, aliases: aliasList.map(([, a]) => a) },
          },
          { from: vendor, where: and(eq(vendor.id, id), eq(vendor.serverSeq, seq)) },
        ),
      ];
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (/UNIQUE constraint failed: vendor/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "That name is already used by another vendor" });
        }
        throw e;
      }
      const [created] = await ctx.db
        .select({ id: vendor.id })
        .from(vendor)
        .where(and(eq(vendor.id, id), eq(vendor.companyId, ctx.companyId)))
        .limit(1);
      if (!created) throw new TRPCError({ code: "CONFLICT", message: "That name is already used by another vendor" });
      const aliasRows = await ctx.db
        .select({ id: vendorAlias.id })
        .from(vendorAlias)
        .where(and(eq(vendorAlias.companyId, ctx.companyId), eq(vendorAlias.vendorId, id)));
      return { id, status, aliasesAdded: aliasRows.length };
    }),

  /** Edit a vendor (masters.publish). `status` may move between draft/active/archived, never to merged. */
  update: actionProcedure("masters.publish")
    .input(
      z.object({
        id: z.string().min(1),
        name: vendorName.optional(),
        gstin: gstin.nullable().optional(),
        phone: optText(40),
        city: optText(80),
        notes: optText(500),
        status: z.enum(["draft", "active", "archived"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadVendor(ctx, input.id);
      if (existing.status === "merged") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This vendor was merged into another one" });
      }
      const { id: _id, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<
        typeof vendor.$inferInsert
      >;
      let key: string | null = null;
      if (input.name !== undefined) {
        key = nameKey(input.name);
        if (key !== existing.nameKey) {
          const owner = await keyOwner(ctx, key, existing.id);
          if (owner) throw taken(owner.name);
          patch.nameKey = key;
        }
      }
      if (Object.keys(patch).length === 0) return { success: true };
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const mine = and(eq(vendor.id, existing.id), eq(vendor.companyId, ctx.companyId), ne(vendor.status, "merged"));
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(vendor)
            .set({ ...patch, serverSeq: seq })
            .where(and(mine, patch.nameKey ? noAliasKey(ctx.companyId, patch.nameKey, existing.id) : undefined)),
          auditInsertGuarded(
            ctx,
            {
              action: "vendor.update",
              subjectType: "vendor",
              subjectId: existing.id,
              meta: {
                before: Object.fromEntries(Object.keys(patch).map((k) => [k, existing[k as keyof typeof existing] ?? null])),
                patch,
              },
            },
            { from: vendor, where: and(eq(vendor.id, existing.id), eq(vendor.serverSeq, seq)) },
          ),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: vendor/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "That name is already used by another vendor" });
        }
        throw e;
      }
      const [landed] = await ctx.db
        .select({ id: vendor.id })
        .from(vendor)
        .where(and(eq(vendor.id, existing.id), eq(vendor.serverSeq, seq)))
        .limit(1);
      if (!landed) throw new TRPCError({ code: "CONFLICT", message: "The vendor changed; try again" });
      return { success: true };
    }),

  /** Confirm a draft vendor created at the kanta (masters.publish). */
  confirm: actionProcedure("masters.publish")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadVendor(ctx, input.id);
      if (existing.status !== "draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a draft vendor can be confirmed" });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(vendor)
          .set({ status: "active", serverSeq: seq })
          .where(and(eq(vendor.id, existing.id), eq(vendor.companyId, ctx.companyId), eq(vendor.status, "draft"))),
        auditInsertGuarded(
          ctx,
          { action: "vendor.confirm", subjectType: "vendor", subjectId: existing.id, meta: { name: existing.name } },
          { from: vendor, where: and(eq(vendor.id, existing.id), eq(vendor.serverSeq, seq)) },
        ),
      ]);
      return { success: true };
    }),

  /** Another spelling of a vendor (masters.publish). A spelling belongs to one vendor only. */
  addAlias: actionProcedure("masters.publish")
    .input(z.object({ vendorId: z.string().min(1), alias: vendorName }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadVendor(ctx, input.vendorId);
      if (existing.status === "merged") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This vendor was merged into another one" });
      }
      const key = nameKey(input.alias);
      if (key === existing.nameKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That is already the vendor's name" });
      }
      const owner = await keyOwner(ctx, key);
      if (owner) throw taken(owner.name);
      const id = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          aliasInsert({ ...ctx, userId: ctx.session.user.id }, { id, vendorId: existing.id, alias: input.alias, key, seq }),
          auditInsertGuarded(
            ctx,
            { action: "vendor.alias.add", subjectType: "vendor", subjectId: existing.id, meta: { alias: input.alias } },
            { from: vendorAlias, where: and(eq(vendorAlias.id, id), eq(vendorAlias.serverSeq, seq)) },
          ),
        ]);
      } catch (e) {
        if (/UNIQUE constraint failed: vendor_alias/.test(errorText(e))) {
          throw new TRPCError({ code: "CONFLICT", message: "That spelling already belongs to another vendor" });
        }
        throw e;
      }
      const [landed] = await ctx.db
        .select({ id: vendorAlias.id })
        .from(vendorAlias)
        .where(and(eq(vendorAlias.id, id), eq(vendorAlias.companyId, ctx.companyId)))
        .limit(1);
      if (!landed) throw new TRPCError({ code: "CONFLICT", message: "The vendor changed; try again" });
      return { id };
    }),

  removeAlias: actionProcedure("masters.publish")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(vendorAlias)
        .where(and(eq(vendorAlias.id, input.id), eq(vendorAlias.companyId, ctx.companyId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      await atomicBatch(ctx.db, [
        ctx.db.delete(vendorAlias).where(and(eq(vendorAlias.id, row.id), eq(vendorAlias.companyId, ctx.companyId))),
        auditInsert(ctx, {
          action: "vendor.alias.remove",
          subjectType: "vendor",
          subjectId: row.vendorId,
          meta: { alias: row.alias },
        }),
      ]);
      return { success: true };
    }),

  /**
   * Fold `mergeIds` into `keepId` (masters.publish): their lots and aliases move to the keeper,
   * their names become aliases of it (unless the keeper already has that spelling), vendors that
   * were merged into them follow, and they become `merged`. Every statement is guarded on the
   * keeper still being live at write time, so a merge racing another merge cannot move lots onto
   * a vendor that was itself just merged away.
   */
  merge: actionProcedure("masters.publish")
    .input(
      z.object({
        keepId: z.string().min(1),
        mergeIds: z.array(z.string().min(1)).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const mergeIds = [...new Set(input.mergeIds)];
      if (mergeIds.includes(input.keepId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A vendor cannot be merged into itself" });
      }
      const keep = await loadVendor(ctx, input.keepId);
      if (keep.status === "merged" || keep.status === "archived") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Keep a live vendor" });
      }
      const rows = await ctx.db
        .select({ id: vendor.id, name: vendor.name, nameKey: vendor.nameKey, status: vendor.status })
        .from(vendor)
        .where(and(eq(vendor.companyId, ctx.companyId), inArray(vendor.id, mergeIds)));
      if (rows.length !== mergeIds.length) throw new TRPCError(NOT_FOUND);
      if (rows.some((r) => r.status === "merged")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "One of these vendors was already merged" });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const userId = ctx.session.user.id;
      const keepLive = sql`exists (select 1 from ${vendor} k where k.id = ${keep.id} and k.company_id = ${ctx.companyId} and k.status in ('draft', 'active'))`;
      const [lotsBefore] = await ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(purchaseLot)
        .where(and(eq(purchaseLot.companyId, ctx.companyId), inArray(purchaseLot.vendorId, mergeIds)));

      // Names of merged vendors become aliases of the keeper (one per distinct key, never the keeper's own).
      const nameAliases = new Map<string, string>();
      for (const r of rows) if (r.nameKey !== keep.nameKey && !nameAliases.has(r.nameKey)) nameAliases.set(r.nameKey, r.name);

      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(vendor)
          .set({ status: "merged", mergedIntoId: keep.id, serverSeq: seq })
          .where(and(eq(vendor.companyId, ctx.companyId), inArray(vendor.id, mergeIds), ne(vendor.status, "merged"), keepLive)),
        // Earlier merges into these vendors now point at the keeper.
        ctx.db
          .update(vendor)
          .set({ mergedIntoId: keep.id, serverSeq: seq })
          .where(and(eq(vendor.companyId, ctx.companyId), inArray(vendor.mergedIntoId, mergeIds), keepLive)),
        ctx.db
          .update(purchaseLot)
          .set({ vendorId: keep.id, serverSeq: seq })
          .where(and(eq(purchaseLot.companyId, ctx.companyId), inArray(purchaseLot.vendorId, mergeIds), keepLive)),
        ctx.db
          .update(vendorAlias)
          .set({ vendorId: keep.id, serverSeq: seq })
          .where(and(eq(vendorAlias.companyId, ctx.companyId), inArray(vendorAlias.vendorId, mergeIds), keepLive)),
        // An alias that now repeats the keeper's own name is pointless.
        ctx.db
          .delete(vendorAlias)
          .where(
            and(eq(vendorAlias.companyId, ctx.companyId), eq(vendorAlias.vendorId, keep.id), eq(vendorAlias.aliasKey, keep.nameKey)),
          ),
        ...[...nameAliases.entries()].map(([key, name]) =>
          ctx.db
            .insert(vendorAlias)
            .select(
              ctx.db
                .select({
                  id: sql<string>`${crypto.randomUUID()}`.as("id"),
                  companyId: sql<string>`${ctx.companyId}`.as("company_id"),
                  serverSeq: sql<number>`${seq}`.as("server_seq"),
                  vendorId: sql<string>`${keep.id}`.as("vendor_id"),
                  alias: sql<string>`${name}`.as("alias"),
                  aliasKey: sql<string>`${key}`.as("alias_key"),
                  createdBy: sql<string>`${userId}`.as("created_by"),
                  createdAt: sql<number>`${Date.now()}`.as("created_at"),
                })
                .from(vendor)
                .where(
                  and(
                    eq(vendor.id, keep.id),
                    eq(vendor.companyId, ctx.companyId),
                    inArray(vendor.status, LIVE),
                    // Only when this request's merge landed for a vendor with that name.
                    sql`exists (select 1 from ${vendor} m where m.company_id = ${ctx.companyId} and m.name_key = ${key} and m.status = 'merged' and m.merged_into_id = ${keep.id} and m.server_seq = ${seq})`,
                  ),
                ),
            )
            .onConflictDoNothing(),
        ),
        auditInsertGuarded(
          ctx,
          {
            action: "vendor.merge",
            subjectType: "vendor",
            subjectId: keep.id,
            meta: { keep: { id: keep.id, name: keep.name }, merged: rows.map((r) => ({ id: r.id, name: r.name })) },
          },
          {
            from: vendor,
            where: and(eq(vendor.companyId, ctx.companyId), inArray(vendor.id, mergeIds), eq(vendor.serverSeq, seq), eq(vendor.status, "merged")),
          },
        ),
      ];
      await atomicBatch(ctx.db, statements);

      const [mergedRow] = await ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(vendor)
        .where(and(eq(vendor.companyId, ctx.companyId), inArray(vendor.id, mergeIds), eq(vendor.serverSeq, seq), eq(vendor.status, "merged")));
      const merged = Number(mergedRow?.n ?? 0);
      if (merged === 0) throw new TRPCError({ code: "CONFLICT", message: "The vendors changed; try again" });
      return { keepId: keep.id, merged, lotsMoved: Number(lotsBefore?.n ?? 0) };
    }),
});
