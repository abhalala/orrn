/**
 * Stock count and phantom report (PL-10; spec P6, §5 "Count close"; digest Stage 14).
 *
 * - `start`: a count over active yard locations (`CNT-{n}`); a location is in one open count. A
 *   count over every active yard also expects bundles with no place (`includeUnplaced`).
 * - `scan`: codes seen at a counted location (plant number, old number, legacy cuid, QR text);
 *   repeats are ignored, unknown codes are kept (they become "found").
 * - `removeScans`: take back scans while the count is open (wrong location picked).
 * - `get`: the count, its scans and its report (live preview while open = the missing list).
 * - `close`: freezes phantom / found / moved; no kg rows (the closed count is the checkpoint).
 *   A yard nobody scanned that would report phantoms needs `confirmUnscanned` (close is final).
 * - `cancel`: abandon an open count (reason required); its locations are free again.
 * - `resolve`: void_phantom → a `phantom_void` approval (a manager voids); move_found → move rows.
 * - `list`, `phantomSummary`: reads for every member.
 *
 * Mutations need `stock.count` (digest §4.2 "Move stock, count stock").
 */
import { TRPCError } from "@trpc/server";
import { and, asc, count as countFn, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { classifyCode } from "@orrn/domain";
import { approval } from "@orrn/db/schema/approval";
import { user } from "@orrn/db/schema/auth";
import {
  countLine,
  countLocation,
  countSeen,
  countSession,
  countStatuses,
  type CountSeenKind,
  type CountSessionRow,
} from "@orrn/db/schema/count";
import { bundle } from "@orrn/db/schema/inventory";
import { location } from "@orrn/db/schema/stock";

import type { Context } from "../context";
import { actionProcedure, companyProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { atomicBatch, atomicBatchLast, chunk, mapInChunks, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { bundleBlockReason, holdingDispatchCodes } from "../lib/bundleHold";
import { now as clockNow } from "../lib/clock";
import { resolveCode } from "../lib/codeResolver";
import { closeStatements, countReport, phantomSummary, sightingsOf, unscannedPhantoms } from "../lib/count";
import { nextDocNumber } from "../lib/docNumber";
import { LEDGER_IN_CHUNK, moveRows, type PostingCtx } from "../lib/ledger";
import { can } from "../lib/permissions";
import { nextCompanySeq } from "../lib/sequence";
import { errorText } from "../lib/store";

/** Codes per scan request: a wedge scanner sends one, an offline queue sends a batch. */
const MAX_CODES = 200;
/** Bundles per resolve request (a whole yard's phantoms fit in a few requests). */
const MAX_RESOLVE = 500;

const id = z.string().trim().min(1).max(64);
const IN_STOCK = new Set(["available", "reserved"]);

type CountCtx = Pick<Context, "session" | "impersonation"> & {
  db: OrrnDb;
  companyId: string;
  session: NonNullable<Context["session"]>;
};

function auditCtx(ctx: CountCtx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

/**
 * The normalised code stored for a scan: serial, legacy cuid, or the trimmed raw text in upper
 * case (so `lot/7a` and `LOT/7A` are one unknown code, as serials already are).
 */
function codeKey(raw: string): string {
  const c = classifyCode(raw);
  if (c.kind === "cuid") return c.id;
  if (c.kind === "unknown") return raw.trim().slice(0, 200).toUpperCase();
  return c.serial;
}

/** Candidates the floor is offered for an ambiguous old number (newest year first). */
const MAX_CANDIDATES = 10;

async function loadSession(db: OrrnDb, companyId: string, sessionId: string): Promise<CountSessionRow> {
  const [row] = await db
    .select()
    .from(countSession)
    .where(and(eq(countSession.id, sessionId), eq(countSession.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Count not found" });
  return row;
}

async function sessionLocationRows(db: OrrnDb, companyId: string, sessionId: string) {
  return db
    .select({ id: location.id, code: location.code, name: location.name, kind: location.kind })
    .from(countLocation)
    .innerJoin(location, and(eq(location.id, countLocation.locationId), eq(location.companyId, countLocation.companyId)))
    .where(and(eq(countLocation.companyId, companyId), eq(countLocation.sessionId, sessionId)))
    .orderBy(asc(location.sortOrder), asc(location.code));
}

function notOpen(session: CountSessionRow): TRPCError {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: session.status === "closed" ? `${session.number} is closed` : `${session.number} was cancelled`,
  });
}

/** "Y1 is already being counted in CNT-3" for the first of `locationIds` in an open count. */
async function openCountConflict(db: OrrnDb, companyId: string, locationIds: string[]): Promise<string | null> {
  const [hit] = await db
    .select({ code: location.code, number: countSession.number })
    .from(countLocation)
    .innerJoin(countSession, and(eq(countSession.id, countLocation.sessionId), eq(countSession.companyId, countLocation.companyId)))
    .innerJoin(location, and(eq(location.id, countLocation.locationId), eq(location.companyId, countLocation.companyId)))
    .where(
      and(
        eq(countLocation.companyId, companyId),
        eq(countLocation.status, "open"),
        inArray(countLocation.locationId, locationIds),
      ),
    )
    .limit(1);
  return hit ? `${hit.code} is already being counted in ${hit.number}` : null;
}

const starter = alias(user, "count_started_by");
const closer = alias(user, "count_closed_by");

export const countRouter = router({
  /** Counts, newest first, with their locations and totals. Every member may read. */
  list: companyProcedure
    .input(
      z
        .object({
          status: z.enum(countStatuses).optional(),
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 20, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(eq(countSession.companyId, ctx.companyId), input.status ? eq(countSession.status, input.status) : undefined);
      const rows = await ctx.db
        .select({
          id: countSession.id,
          number: countSession.number,
          status: countSession.status,
          includeUnplaced: countSession.includeUnplaced,
          note: countSession.note,
          startedAt: countSession.createdAt,
          startedByName: starter.name,
          closedAt: countSession.closedAt,
          cancelledAt: countSession.cancelledAt,
          expected: countSession.expectedCount,
          seen: countSession.seenCount,
          phantom: countSession.phantomCount,
          phantomG: countSession.phantomG,
          found: countSession.foundCount,
          moved: countSession.movedCount,
        })
        .from(countSession)
        .leftJoin(starter, eq(starter.id, countSession.createdBy))
        .where(where)
        .orderBy(desc(countSession.createdAt), desc(countSession.serverSeq))
        .limit(input.limit)
        .offset(input.offset);
      const locs = rows.length
        ? await mapInChunks(
            rows.map((r) => r.id),
            (ids) =>
              ctx.db
                .select({ sessionId: countLocation.sessionId, code: location.code })
                .from(countLocation)
                .innerJoin(location, and(eq(location.id, countLocation.locationId), eq(location.companyId, countLocation.companyId)))
                .where(and(eq(countLocation.companyId, ctx.companyId), inArray(countLocation.sessionId, ids))),
          )
        : [];
      const [totalRow] = await ctx.db.select({ n: countFn() }).from(countSession).where(where);
      const total = Number(totalRow?.n ?? 0);
      const next = input.offset + rows.length;
      return {
        items: rows.map((r) => ({
          ...r,
          locationCodes: locs.filter((l) => l.sessionId === r.id).map((l) => l.code).sort(),
        })),
        total,
        nextOffset: next < total ? next : null,
      };
    }),

  /**
   * One count: header, locations, a page of its scans (newest first, `scanTotal` in all) and its
   * report (live preview while open). The report is never paged: the missing list, by-cast and
   * by-age need every line, and a count's lines are bounded by the stock in its yards.
   */
  get: companyProcedure
    .input(
      z.object({
        sessionId: id,
        scanLimit: z.number().int().min(1).max(500).default(100),
        scanOffset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const s = await loadSession(ctx.db, ctx.companyId, input.sessionId);
      const scanWhere = and(eq(countSeen.companyId, ctx.companyId), eq(countSeen.sessionId, s.id));
      const [locations, scans, [scanCount], [names]] = await Promise.all([
        sessionLocationRows(ctx.db, ctx.companyId, s.id),
        ctx.db
          .select({
            id: countSeen.id,
            code: countSeen.code,
            resolveKind: countSeen.resolveKind,
            bundleId: countSeen.bundleId,
            serial: bundle.serial,
            locationId: countSeen.locationId,
            locationCode: location.code,
            scannedAt: countSeen.scannedAt,
          })
          .from(countSeen)
          .leftJoin(bundle, and(eq(bundle.id, countSeen.bundleId), eq(bundle.companyId, countSeen.companyId)))
          .leftJoin(location, and(eq(location.id, countSeen.locationId), eq(location.companyId, countSeen.companyId)))
          .where(scanWhere)
          .orderBy(desc(countSeen.scannedAt), desc(countSeen.serverSeq), asc(countSeen.code))
          .limit(input.scanLimit)
          .offset(input.scanOffset),
        ctx.db.select({ n: countFn() }).from(countSeen).where(scanWhere),
        ctx.db
          .select({ startedByName: starter.name, closedByName: closer.name })
          .from(countSession)
          .leftJoin(starter, eq(starter.id, countSession.createdBy))
          .leftJoin(closer, eq(closer.id, countSession.closedBy))
          .where(and(eq(countSession.id, s.id), eq(countSession.companyId, ctx.companyId))),
      ]);
      const report = await countReport(ctx.db, ctx.companyId, s, clockNow());
      const scanTotal = Number(scanCount?.n ?? 0);
      const scanNext = input.scanOffset + scans.length;
      return {
        session: {
          id: s.id,
          number: s.number,
          status: s.status,
          includeUnplaced: s.includeUnplaced,
          note: s.note,
          startedAt: s.createdAt,
          startedByName: names?.startedByName ?? null,
          closedAt: s.closedAt,
          closedByName: names?.closedByName ?? null,
          cancelledAt: s.cancelledAt,
          cancelReason: s.cancelReason,
        },
        locations,
        scans,
        scanTotal,
        scanNextOffset: scanNext < scanTotal ? scanNext : null,
        report,
      };
    }),

  /** The last count's phantom share and the phantoms still missing (7 am report / Today). */
  phantomSummary: companyProcedure.query(({ ctx }) => phantomSummary(ctx.db, ctx.companyId)),

  start: actionProcedure("stock.count")
    .input(
      z.object({
        locationIds: z.array(id).min(1, "Pick at least one location").max(20),
        /**
         * Expect bundles with no place too (unseen ones become phantoms). Default: on when the count
         * covers every active yard, off otherwise; only a count over every active yard may set it.
         */
        includeUnplaced: z.boolean().optional(),
        note: z.string().trim().max(500).optional(),
        /**
         * Replay key (RP18, review round 1 m-3): a retry with the same key returns the count the
         * first call started, instead of "already being counted" for the caller's own count. The
         * same key for other yards is a CONFLICT.
         */
        clientRequestId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const wanted = [...new Set(input.locationIds)];
      /** The count this key already started, if any (CONFLICT when it was for other yards). */
      const byRequest = async () => {
        if (!input.clientRequestId) return null;
        const [prior] = await ctx.db
          .select({ id: countSession.id, number: countSession.number, includeUnplaced: countSession.includeUnplaced })
          .from(countSession)
          .where(and(eq(countSession.companyId, ctx.companyId), eq(countSession.clientRequestId, input.clientRequestId)))
          .limit(1);
        if (!prior) return null;
        const covered = await ctx.db
          .select({ locationId: countLocation.locationId })
          .from(countLocation)
          .where(and(eq(countLocation.companyId, ctx.companyId), eq(countLocation.sessionId, prior.id)));
        const same =
          covered.length === wanted.length &&
          covered.every((c) => wanted.includes(c.locationId)) &&
          (input.includeUnplaced === undefined || input.includeUnplaced === prior.includeUnplaced);
        if (!same) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `This start was already used for ${prior.number} over other yards. Reload and start again.`,
          });
        }
        return { id: prior.id, number: prior.number, replayed: true as const };
      };
      const replay = await byRequest();
      if (replay) return replay;
      const locs = await ctx.db
        .select()
        .from(location)
        .where(and(eq(location.companyId, ctx.companyId), inArray(location.id, wanted)));
      if (locs.length !== wanted.length) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
      for (const l of locs) {
        if (!l.active) throw new TRPCError({ code: "BAD_REQUEST", message: `Location ${l.code} is retired` });
        if (l.kind !== "yard") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `A count covers yard locations; ${l.code} is not a yard` });
        }
      }
      const busy = await openCountConflict(ctx.db, ctx.companyId, wanted);
      if (busy) throw new TRPCError({ code: "CONFLICT", message: busy });
      // A bundle with no place is missing only if no yard holds it: that needs every active yard.
      const activeYards = await ctx.db
        .select({ id: location.id })
        .from(location)
        .where(and(eq(location.companyId, ctx.companyId), eq(location.kind, "yard"), eq(location.active, true)));
      const everyYard = activeYards.every((y) => wanted.includes(y.id));
      if (input.includeUnplaced && !everyYard) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bundles with no place can be counted only in a count of every active yard",
        });
      }
      const includeUnplaced = input.includeUnplaced ?? everyYard;

      const startedAt = clockNow();
      const userId = ctx.session.user.id;
      const doc = await nextDocNumber(ctx.db, ctx.companyId, "count", startedAt, userId);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const sessionId = crypto.randomUUID();
      const statements: SqliteBatchItem[] = [
        ctx.db.insert(countSession).values({
          id: sessionId,
          companyId: ctx.companyId,
          serverSeq: seq,
          number: doc.number,
          period: doc.period,
          status: "open",
          startSeq: seq,
          includeUnplaced,
          note: input.note ? input.note : null,
          clientRequestId: input.clientRequestId ?? null,
          createdBy: userId,
          createdAt: startedAt,
          updatedAt: startedAt,
        }),
      ];
      pushChunkedInserts(
        statements,
        (rows) => ctx.db.insert(countLocation).values(rows),
        locs.map((l) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq: seq,
          sessionId,
          locationId: l.id,
          status: "open" as const,
          createdBy: userId,
        })),
      );
      statements.push(
        auditInsert(auditCtx(ctx), {
          action: "count.start",
          subjectType: "count_session",
          subjectId: sessionId,
          meta: { number: doc.number, locations: locs.map((l) => l.code), includeUnplaced },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        // The same key raced in from a retry: the first one's count stands (this CNT number is a gap).
        if (input.clientRequestId && /UNIQUE constraint failed: count_session\.company_id, count_session\.client_request_id/.test(errorText(e))) {
          const won = await byRequest();
          if (won) return won;
        }
        // Another start took one of these locations after our check (partial unique index).
        if (/UNIQUE constraint failed: count_location/.test(errorText(e))) {
          const msg = await openCountConflict(ctx.db, ctx.companyId, wanted);
          throw new TRPCError({ code: "CONFLICT", message: msg ?? "One of these locations is already being counted" });
        }
        throw e;
      }
      return { id: sessionId, number: doc.number, replayed: false as const };
    }),

  /**
   * Record codes seen at a counted location. A count over one location needs no `locationId`.
   * Per code: `recorded` or `duplicate` (already in this count: first scan wins), and what the
   * system says about it right now (`match`) so the floor hears the difference at once.
   */
  scan: actionProcedure("stock.count")
    .input(
      z.object({
        sessionId: id,
        locationId: id.optional(),
        codes: z.array(z.string().trim().min(1).max(200)).min(1, "Scan at least one code").max(MAX_CODES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const s = await loadSession(ctx.db, ctx.companyId, input.sessionId);
      if (s.status !== "open") throw notOpen(s);
      const locs = await sessionLocationRows(ctx.db, ctx.companyId, s.id);
      const locIds = new Set(locs.map((l) => l.id));
      let at: string;
      if (input.locationId) {
        if (!locIds.has(input.locationId)) {
          const [ours] = await ctx.db
            .select({ id: location.id })
            .from(location)
            .where(and(eq(location.id, input.locationId), eq(location.companyId, ctx.companyId)))
            .limit(1);
          if (!ours) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
          throw new TRPCError({ code: "BAD_REQUEST", message: `That location is not part of ${s.number}` });
        }
        at = input.locationId;
      } else if (locs.length === 1) {
        at = locs[0]!.id;
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the location you are counting" });
      }

      // Normalise and resolve each distinct code once (company scoped).
      const keys = input.codes.map(codeKey);
      const firstRaw = new Map<string, string>();
      input.codes.forEach((raw, i) => {
        if (!firstRaw.has(keys[i]!)) firstRaw.set(keys[i]!, raw);
      });
      const distinct = [...firstRaw.keys()];
      type Resolved = { kind: CountSeenKind; bundleId: string | null; candidates: { bundleId: string; serial: string }[] };
      const resolved = new Map<string, Resolved>();
      await Promise.all(
        distinct.map(async (key) => {
          const r = await resolveCode(ctx.db, ctx.companyId, firstRaw.get(key)!);
          resolved.set(
            key,
            r.kind === "bundle"
              ? { kind: "bundle", bundleId: r.bundleId, candidates: [] }
              : r.kind === "ambiguous"
                ? {
                    kind: "ambiguous",
                    bundleId: null,
                    candidates: r.candidates.slice(0, MAX_CANDIDATES).map((c) => ({ bundleId: c.bundleId, serial: c.number })),
                  }
                : { kind: "not_found", bundleId: null, candidates: [] },
          );
        }),
      );
      const bundleIds = [...new Set([...resolved.values()].map((r) => r.bundleId).filter((x): x is string => !!x))];
      // Bundle facts for the feedback, and earlier scans of these codes or these bundles.
      const [bundles, existing, existingByBundle] = await Promise.all([
        mapInChunks(bundleIds, (ids) =>
          ctx.db
            .select({
              id: bundle.id,
              serial: bundle.serial,
              status: bundle.status,
              locationId: bundle.locationId,
              weightG: bundle.weightG,
            })
            .from(bundle)
            .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, ids))),
        ),
        mapInChunks(distinct, (codes) =>
          ctx.db
            .select({ code: countSeen.code, bundleId: countSeen.bundleId, locationId: countSeen.locationId })
            .from(countSeen)
            .where(and(eq(countSeen.companyId, ctx.companyId), eq(countSeen.sessionId, s.id), inArray(countSeen.code, codes))),
        ),
        mapInChunks(bundleIds, (ids) =>
          ctx.db
            .select({ code: countSeen.code, bundleId: countSeen.bundleId, locationId: countSeen.locationId })
            .from(countSeen)
            .where(and(eq(countSeen.companyId, ctx.companyId), eq(countSeen.sessionId, s.id), inArray(countSeen.bundleId, ids))),
        ),
      ]);
      const bundleOf = new Map(bundles.map((b) => [b.id, b]));
      const seenCode = new Map(existing.map((e) => [e.code, e.locationId]));
      const seenBundle = new Map(existingByBundle.map((e) => [e.bundleId!, e.locationId]));

      // Decide per distinct code: new, or a repeat (by code or by bundle, earlier or in this request).
      const fresh: { key: string; kind: CountSeenKind; bundleId: string | null; seenId: string }[] = [];
      const firstLocation = new Map<string, string>();
      const takenBundles = new Set<string>();
      for (const key of distinct) {
        const r = resolved.get(key)!;
        const earlier = seenCode.get(key) ?? (r.bundleId ? seenBundle.get(r.bundleId) : undefined);
        if (earlier) {
          firstLocation.set(key, earlier);
          continue;
        }
        if (r.bundleId && takenBundles.has(r.bundleId)) {
          firstLocation.set(key, at);
          continue;
        }
        if (r.bundleId) takenBundles.add(r.bundleId);
        fresh.push({ key, kind: r.kind, bundleId: r.bundleId, seenId: crypto.randomUUID() });
      }

      let landedIds = new Set<string>();
      if (fresh.length > 0) {
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const scannedAt = clockNow().getTime();
        const createdAt = Date.now();
        const userId = ctx.session.user.id;
        const openNow = and(
          eq(countSession.id, s.id),
          eq(countSession.companyId, ctx.companyId),
          eq(countSession.status, "open"),
        );
        // One guarded INSERT … SELECT per code (≈ 13 bound values): lands only while the count is
        // open at write time; a repeat that raced in is skipped by the unique indexes.
        const statements: SqliteBatchItem[] = fresh.map((f) =>
          ctx.db
            .insert(countSeen)
            .select(
              ctx.db
                .select({
                  id: sql<string>`${f.seenId}`.as("id"),
                  companyId: sql<string>`${ctx.companyId}`.as("company_id"),
                  serverSeq: sql<number>`${seq}`.as("server_seq"),
                  sessionId: sql<string>`${s.id}`.as("session_id"),
                  locationId: sql<string>`${at}`.as("location_id"),
                  code: sql<string>`${f.key}`.as("code"),
                  resolveKind: sql<string>`${f.kind}`.as("resolve_kind"),
                  bundleId: sql<string | null>`${f.bundleId}`.as("bundle_id"),
                  scannedAt: sql<number>`${scannedAt}`.as("scanned_at"),
                  createdBy: sql<string>`${userId}`.as("created_by"),
                  createdAt: sql<number>`${createdAt}`.as("created_at"),
                })
                .from(countSession)
                .where(openNow)
                .limit(1),
            )
            .onConflictDoNothing(),
        );
        const landed = await atomicBatchLast<{ id: string }>(ctx.db, [
          ...statements,
          ctx.db
            .select({ id: countSeen.id })
            .from(countSeen)
            .where(and(eq(countSeen.companyId, ctx.companyId), eq(countSeen.sessionId, s.id), eq(countSeen.serverSeq, seq))),
        ]);
        landedIds = new Set(landed.map((r) => r.id));
        if (landedIds.size === 0) {
          const now = await loadSession(ctx.db, ctx.companyId, s.id);
          if (now.status !== "open") throw notOpen(now);
        }
        // Codes a concurrent scan took first (unique indexes): name the yard where that scan landed.
        const lost = fresh.filter((f) => !landedIds.has(f.seenId));
        if (lost.length > 0) {
          const lostBundles = lost.map((f) => f.bundleId).filter((x): x is string => !!x);
          const [byCode, byBundle] = await Promise.all([
            mapInChunks(
              lost.map((f) => f.key),
              (codes) =>
                ctx.db
                  .select({ code: countSeen.code, locationId: countSeen.locationId })
                  .from(countSeen)
                  .where(and(eq(countSeen.companyId, ctx.companyId), eq(countSeen.sessionId, s.id), inArray(countSeen.code, codes))),
            ),
            mapInChunks(lostBundles, (ids) =>
              ctx.db
                .select({ bundleId: countSeen.bundleId, locationId: countSeen.locationId })
                .from(countSeen)
                .where(and(eq(countSeen.companyId, ctx.companyId), eq(countSeen.sessionId, s.id), inArray(countSeen.bundleId, ids))),
            ),
          ]);
          const codeAt = new Map(byCode.map((r) => [r.code, r.locationId]));
          const bundleAt = new Map(byBundle.map((r) => [r.bundleId!, r.locationId]));
          for (const f of lost) {
            const where = codeAt.get(f.key) ?? (f.bundleId ? bundleAt.get(f.bundleId) : undefined);
            if (where) firstLocation.set(f.key, where);
          }
        }
      }

      const freshByKey = new Map(fresh.map((f) => [f.key, f]));
      const results = keys.map((key, i) => {
        const r = resolved.get(key)!;
        const b = r.bundleId ? (bundleOf.get(r.bundleId) ?? null) : null;
        const f = freshByKey.get(key);
        // Only the first occurrence of a fresh code in the request is the recorded one.
        const isFirst = keys.indexOf(key) === i;
        const recorded = Boolean(f && isFirst && landedIds.has(f.seenId));
        const match: "here" | "moved" | "elsewhere" | "not_in_stock" | "unknown" | "ambiguous" =
          r.kind === "ambiguous"
            ? "ambiguous"
            : !b
              ? "unknown"
              : !IN_STOCK.has(b.status)
                ? "not_in_stock"
                : b.locationId === at
                  ? "here"
                  : b.locationId && locIds.has(b.locationId)
                    ? "moved"
                    : "elsewhere";
        return {
          code: key,
          outcome: recorded ? ("recorded" as const) : ("duplicate" as const),
          seenId: recorded ? f!.seenId : null,
          firstLocationId: recorded ? null : (firstLocation.get(key) ?? at),
          match,
          bundle: b,
          /** Ambiguous old number: the bundles it could be (newest year first); scan the full number. */
          candidates: r.candidates,
        };
      });
      const recorded = results.filter((r) => r.outcome === "recorded").length;
      return { recorded, duplicates: results.length - recorded, results };
    }),

  /** Take back scans of an open count (e.g. scanned with the wrong location picked). */
  removeScans: actionProcedure("stock.count")
    .input(z.object({ sessionId: id, seenIds: z.array(id).min(1).max(MAX_CODES) }))
    .mutation(async ({ ctx, input }) => {
      const s = await loadSession(ctx.db, ctx.companyId, input.sessionId);
      if (s.status !== "open") throw notOpen(s);
      const wanted = [...new Set(input.seenIds)];
      const mine = (ids: string[]) =>
        and(eq(countSeen.companyId, ctx.companyId), eq(countSeen.sessionId, s.id), inArray(countSeen.id, ids));
      const before = await mapInChunks(wanted, (ids) =>
        ctx.db
          .select({ id: countSeen.id, code: countSeen.code, bundleId: countSeen.bundleId, locationId: countSeen.locationId })
          .from(countSeen)
          .where(mine(ids)),
      );
      if (before.length === 0) return { removed: 0 };
      const openNow = sql`exists (select 1 from ${countSession} cs where cs.id = ${s.id} and cs.company_id = ${ctx.companyId} and cs.status = 'open')`;
      await atomicBatch(ctx.db, [
        ...chunk(
          before.map((b) => b.id),
          80,
        ).map((ids) => ctx.db.delete(countSeen).where(and(mine(ids), openNow))),
        auditInsertGuarded(
          auditCtx(ctx),
          // The scans are deleted, so the audit row keeps what they were (ruling 8: the trail).
          { action: "count.removeScans", subjectType: "count_session", subjectId: s.id, meta: { number: s.number, scans: before } },
          { from: countSession, where: and(eq(countSession.id, s.id), eq(countSession.companyId, ctx.companyId), eq(countSession.status, "open")) },
        ),
      ]);
      const after = await mapInChunks(before.map((b) => b.id), (ids) =>
        ctx.db.select({ id: countSeen.id }).from(countSeen).where(mine(ids)),
      );
      if (after.length === before.length) {
        const now = await loadSession(ctx.db, ctx.companyId, s.id);
        if (now.status !== "open") throw notOpen(now);
      }
      return { removed: before.length - after.length };
    }),

  /**
   * Close the count and freeze its report. Idempotent: closing a closed count returns its report
   * (two people closing at once get the same report; the lines are written once). Close is final,
   * so a counted yard with no scan at all that would report phantoms (or a count with no scan and
   * unplaced phantoms) is refused with PRECONDITION_FAILED until the caller confirms
   * (`confirmUnscanned: true`): the floor either forgot the yard or tapped Close by mistake.
   */
  close: actionProcedure("stock.count")
    .input(z.object({ sessionId: id, confirmUnscanned: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const s = await loadSession(ctx.db, ctx.companyId, input.sessionId);
      if (s.status === "cancelled") throw notOpen(s);
      if (s.status === "open" && !input.confirmUnscanned) {
        const u = await unscannedPhantoms(ctx.db, ctx.companyId, s);
        const parts = u.yards.map((y) => `${y.code} (${y.bundles} ${y.bundles === 1 ? "bundle" : "bundles"})`);
        if (u.unplaced > 0) parts.push(`${u.unplaced} ${u.unplaced === 1 ? "bundle" : "bundles"} with no place`);
        if (parts.length > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Nothing was scanned for ${parts.join(", ")}; closing reports them all missing. Scan them, or close anyway.`,
          });
        }
      }
      if (s.status === "open") {
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const closedAt = clockNow();
        const cctx = { db: ctx.db, companyId: ctx.companyId, userId: ctx.session.user.id, seq, closedAt };
        await atomicBatch(ctx.db, [
          ...closeStatements(cctx, { id: s.id, startSeq: s.startSeq, includeUnplaced: s.includeUnplaced }),
          auditInsertGuarded(
            auditCtx(ctx),
            { action: "count.close", subjectType: "count_session", subjectId: s.id, meta: { number: s.number } },
            {
              from: countSession,
              where: and(eq(countSession.id, s.id), eq(countSession.companyId, ctx.companyId), eq(countSession.closeSeq, seq)),
            },
          ),
        ]);
      }
      const now = await loadSession(ctx.db, ctx.companyId, s.id);
      if (now.status !== "closed") throw notOpen(now);
      return countReport(ctx.db, ctx.companyId, now, clockNow());
    }),

  /** Abandon an open count; nothing is reported and its locations can be counted again. */
  cancel: actionProcedure("stock.count")
    .input(z.object({ sessionId: id, reason: z.string().trim().min(1, "Say why the count is cancelled").max(500) }))
    .mutation(async ({ ctx, input }) => {
      /**
       * Replay-safe (review round 1 m-3): a retry of this user's own cancel, with the same reason,
       * answers success again (no second audit row); anyone else's cancel of a cancelled count is
       * still refused.
       */
      const ownCancel = (row: { status: string; cancelledBy: string | null; cancelReason: string | null }) =>
        row.status === "cancelled" && row.cancelledBy === ctx.session.user.id && row.cancelReason === input.reason;
      const s = await loadSession(ctx.db, ctx.companyId, input.sessionId);
      if (ownCancel(s)) return { success: true, replayed: true };
      if (s.status !== "open") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Only an open count can be cancelled; ${s.number} is ${s.status}` });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      const mine = and(
        eq(countSession.id, s.id),
        eq(countSession.companyId, ctx.companyId),
        eq(countSession.status, "cancelled"),
        eq(countSession.serverSeq, seq),
      );
      await atomicBatch(ctx.db, [
        ctx.db
          .update(countSession)
          .set({ status: "cancelled", cancelledAt: at, cancelledBy: ctx.session.user.id, cancelReason: input.reason, serverSeq: seq })
          .where(and(eq(countSession.id, s.id), eq(countSession.companyId, ctx.companyId), eq(countSession.status, "open"))),
        ctx.db
          .update(countLocation)
          .set({ status: "cancelled", serverSeq: seq })
          .where(
            and(
              eq(countLocation.companyId, ctx.companyId),
              eq(countLocation.sessionId, s.id),
              eq(countLocation.status, "open"),
              sql`exists (select 1 from ${countSession} cs where cs.id = ${s.id} and cs.company_id = ${ctx.companyId} and cs.status = 'cancelled' and cs.server_seq = ${seq})`,
            ),
          ),
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "count.cancel", subjectType: "count_session", subjectId: s.id, meta: { number: s.number, reason: input.reason } },
          { from: countSession, where: mine },
        ),
      ]);
      const [landed] = await ctx.db.select({ id: countSession.id }).from(countSession).where(mine).limit(1);
      if (!landed) {
        const now = await loadSession(ctx.db, ctx.companyId, s.id);
        if (ownCancel(now)) return { success: true, replayed: true };
        throw new TRPCError({ code: "BAD_REQUEST", message: `Only an open count can be cancelled; ${now.number} is ${now.status}` });
      }
      return { success: true, replayed: false };
    }),

  /**
   * Act on a closed count's report.
   * - void_phantom: open phantom lines → one `phantom_void` approval for the count (manager,
   *   admin or owner decides; never the requester). The bundles are voided only on approval.
   * - move_found: moved / found lines whose bundle is in stock → moved to where they were seen
   *   (− at the system's location, + at the seen location), unless the bundle changed since.
   */
  resolve: actionProcedure("stock.count")
    .input(
      z.object({
        sessionId: id,
        action: z.enum(["void_phantom", "move_found"]),
        bundleIds: z.array(id).min(1, "Pick at least one bundle").max(MAX_RESOLVE),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const s = await loadSession(ctx.db, ctx.companyId, input.sessionId);
      if (s.status !== "closed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Close ${s.number} first; only a closed count can be resolved` });
      }
      const wanted = [...new Set(input.bundleIds)];
      const lines = await mapInChunks(wanted, (ids) =>
        ctx.db
          .select({
            id: countLine.id,
            kind: countLine.kind,
            bundleId: countLine.bundleId,
            resolution: countLine.resolution,
            seenLocationId: countLine.seenLocationId,
            weightG: countLine.weightG,
          })
          .from(countLine)
          .where(and(eq(countLine.companyId, ctx.companyId), eq(countLine.sessionId, s.id), inArray(countLine.bundleId, ids))),
      );
      const lineOf = new Map(lines.map((l) => [l.bundleId!, l]));
      const bundles = await mapInChunks(wanted, (ids) =>
        ctx.db
          .select({
            id: bundle.id,
            serial: bundle.serial,
            status: bundle.status,
            currentDispatchId: bundle.currentDispatchId,
            locationId: bundle.locationId,
            weightG: bundle.weightG,
          })
          .from(bundle)
          .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, ids))),
      );
      const bundleOf = new Map(bundles.map((b) => [b.id, b]));
      // Another company's (or no) bundle: it does not exist here.
      if (wanted.some((b) => !bundleOf.has(b))) throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      const serials = (ids: string[]) => {
        const list = ids.slice(0, 5).map((i) => bundleOf.get(i)!.serial);
        return `${list.join(", ")}${ids.length > 5 ? ` and ${ids.length - 5} more` : ""}`;
      };
      const notOnReport = wanted.filter((b) => !lineOf.has(b));
      if (notOnReport.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Not on ${s.number}'s report (it matched): ${serials(notOnReport)}` });
      }
      const userId = ctx.session.user.id;

      if (input.action === "void_phantom") {
        const notPhantom = wanted.filter((b) => lineOf.get(b)!.kind !== "phantom");
        if (notPhantom.length > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Not a phantom of ${s.number}: ${serials(notPhantom)}` });
        }
        const done = wanted.filter((b) => lineOf.get(b)!.resolution !== "open");
        if (done.length > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Already requested or resolved: ${serials(done)}` });
        }
        const blocked = wanted.map((b) => bundleOf.get(b)!).filter((b) => b.status !== "available");
        if (blocked.length > 0) {
          const codes = await holdingDispatchCodes(ctx.db, ctx.companyId, blocked);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot void ${blocked
              .slice(0, 5)
              .map((b) => `${b.serial}: ${bundleBlockReason(b, codes).toLowerCase()}`)
              .join("; ")}`,
          });
        }
        // Another count saw it and that sighting is still to be acted on there (its count is open,
        // or its found / moved line is open): it is misplaced, not missing (spec r0 I-1). The hook
        // re-checks the same rule at decision time (stillPhantomOfLine).
        const seenThere = [...(await sightingsOf(ctx.db, ctx.companyId, s, wanted))].filter(([, v]) => v.resolveThere);
        if (seenThere.length > 0) {
          const parts = seenThere
            .slice(0, 5)
            .map(([b, v]) => `${bundleOf.get(b)!.serial} seen at ${v.locationCode ?? "an unknown place"} in ${v.number}${v.countOpen ? " (still open)" : ""}`);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Not missing: ${parts.join("; ")}${seenThere.length > 5 ? ` and ${seenThere.length - 5} more` : ""}. Move it from that count's report (close that count first if it is still open) instead of voiding it.`,
          });
        }
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const approvalId = crypto.randomUUID();
        const weightG = wanted.reduce((sum, b) => sum + (lineOf.get(b)!.weightG ?? 0), 0);
        const statements: SqliteBatchItem[] = chunk(wanted, LEDGER_IN_CHUNK).map((ids) =>
          ctx.db
            .update(countLine)
            .set({ resolution: "void_requested", approvalId, serverSeq: seq })
            .where(
              and(
                eq(countLine.companyId, ctx.companyId),
                eq(countLine.sessionId, s.id),
                eq(countLine.kind, "phantom"),
                eq(countLine.resolution, "open"),
                inArray(countLine.bundleId, ids),
              ),
            ),
        );
        const requestLanded = and(eq(countLine.companyId, ctx.companyId), eq(countLine.approvalId, approvalId), eq(countLine.serverSeq, seq));
        // The subject was loaded tenant-scoped above. One pending request per count (partial
        // unique index): a second request fails the whole batch, leaving its lines open.
        const request = requestApprovalInsert(ctx, {
          id: approvalId,
          kind: "phantom_void",
          subjectId: s.id,
          serverSeq: seq,
          requestNote: input.note ? input.note : null,
          meta: {
            sessionId: s.id,
            number: s.number,
            bundles: wanted.length,
            weightG,
            serials: wanted.slice(0, 50).map((b) => bundleOf.get(b)!.serial),
          },
          guard: { from: countLine, where: requestLanded },
        });
        statements.push(
          request.statement,
          auditInsertGuarded(
            auditCtx(ctx),
            {
              action: "count.voidRequested",
              subjectType: "count_session",
              subjectId: s.id,
              meta: { approvalId, bundles: wanted.length, weightG },
            },
            { from: approval, where: and(eq(approval.id, approvalId), eq(approval.companyId, ctx.companyId)) },
          ),
        );
        try {
          await atomicBatch(ctx.db, statements);
        } catch (e) {
          if (/UNIQUE constraint failed: approval/.test(errorText(e))) {
            throw new TRPCError({ code: "CONFLICT", message: `A void request for ${s.number} is already waiting for approval` });
          }
          throw e;
        }
        const [landed] = await ctx.db.select({ n: sql<number>`count(*)` }).from(countLine).where(requestLanded);
        const requested = Number(landed?.n ?? 0);
        if (requested === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "These phantoms were already requested or resolved" });
        }
        return { action: "void_phantom" as const, approvalId, requested };
      }

      // move_found
      if (!can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "stock.move")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      }
      const notMovable = wanted.filter((b) => lineOf.get(b)!.kind === "phantom");
      if (notMovable.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Phantoms were not seen; nothing to move: ${serials(notMovable)}` });
      }
      const done = wanted.filter((b) => lineOf.get(b)!.resolution !== "open");
      if (done.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: `Already resolved: ${serials(done)}` });
      const gone = wanted.filter((b) => !IN_STOCK.has(bundleOf.get(b)!.status));
      if (gone.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Not in stock, so it cannot be moved (restore or check the dispatch first): ${serials(gone)}`,
        });
      }
      const byTarget = new Map<string, string[]>();
      for (const b of wanted) {
        const to = lineOf.get(b)!.seenLocationId!;
        byTarget.set(to, [...(byTarget.get(to) ?? []), b]);
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      const posting: PostingCtx = { db: ctx.db, companyId: ctx.companyId, userId, seq, postedAt: at };
      const stillAsCounted: SQL = sql`exists (select 1 from ${countLine} cl where cl.company_id = ${ctx.companyId} and cl.session_id = ${s.id} and cl.bundle_id = ${sql`${sql.identifier("bundle")}.${sql.identifier("id")}`} and cl.kind in ('moved', 'found') and cl.resolution = 'open' and ${sql`${sql.identifier("bundle")}.${sql.identifier("location_id")}`} is cl.system_location_id)`;
      const statements: SqliteBatchItem[] = [];
      const vouchers: string[] = [];
      for (const [to, ids] of byTarget) {
        const voucherId = crypto.randomUUID();
        vouchers.push(voucherId);
        statements.push(
          ...moveRows(posting, { voucherId, bundleIds: ids, toLocationId: to, reason: `Found at count ${s.number}`, onlyIf: stillAsCounted }),
          ...chunk(ids, LEDGER_IN_CHUNK).map((part) =>
            ctx.db
              .update(countLine)
              .set({ resolution: "moved", resolutionVoucherId: voucherId, resolvedAt: at, resolvedBy: userId, serverSeq: seq })
              .where(
                and(
                  eq(countLine.companyId, ctx.companyId),
                  eq(countLine.sessionId, s.id),
                  eq(countLine.resolution, "open"),
                  inArray(countLine.bundleId, part),
                  sql`exists (select 1 from ${bundle} b where b.id = ${sql`${sql.identifier("count_line")}.${sql.identifier("bundle_id")}`} and b.company_id = ${ctx.companyId} and b.server_seq = ${seq} and b.location_id = ${to})`,
                ),
              ),
          ),
        );
      }
      const movedLines = and(
        eq(countLine.companyId, ctx.companyId),
        eq(countLine.sessionId, s.id),
        eq(countLine.serverSeq, seq),
        eq(countLine.resolution, "moved"),
      );
      statements.push(
        auditInsertGuarded(
          auditCtx(ctx),
          { action: "count.moveFound", subjectType: "count_session", subjectId: s.id, meta: { vouchers, requested: wanted.length } },
          { from: countLine, where: movedLines },
        ),
      );
      const landed = await atomicBatchLast<{ bundleId: string; voucherId: string }>(ctx.db, [
        ...statements,
        ctx.db
          .select({ bundleId: sql<string>`${countLine.bundleId}`, voucherId: sql<string>`${countLine.resolutionVoucherId}` })
          .from(countLine)
          .where(movedLines),
      ]);
      const movedSet = new Set(landed.map((r) => r.bundleId));
      const landedVouchers = new Set(landed.map((r) => r.voucherId));
      return {
        action: "move_found" as const,
        moved: movedSet.size,
        skipped: wanted.filter((b) => !movedSet.has(b)),
        voucherIds: vouchers.filter((v) => landedVouchers.has(v)),
      };
    }),
});
