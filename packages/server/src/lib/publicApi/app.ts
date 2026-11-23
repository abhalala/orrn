/**
 * XE PLATFORM row 83: the plant's read-only REST API under `/api/v1/` (opt-in module `api`).
 *
 * Loaded on the first `/api/v1` request (`apps/server/src/index.ts` imports it inside the handler), never at Worker
 * startup. Every call:
 * 1. reads `Authorization: Bearer orrna_<id>_<secret>`, finds the token by id, compares SHA-256(salt + secret);
 * 2. refuses a revoked or expired token, a plant that is not active or has `api` off;
 * 3. reserves one call in the per-minute counter (`api_rate`, one conditional upsert; 429 past the limit);
 * 4. stamps `last_used_at` (at most once a minute);
 * 5. runs the SAME tRPC query the screens use, through `createCaller`, with a context whose only actions are the ones
 *    the token's scopes imply (`prices.read` = `order.price`, `invoices.read` = `invoice.read`), so every router rule,
 *    module gate and tenant scope applies;
 * 6. answers with a whitelist of fields: a rate or an amount appears only with `prices.read`.
 * Nothing else is written. Pages: `?limit=` (at most 100) and `?cursor=` (opaque), answer `{ data, nextCursor }`.
 */
import { TRPCError } from "@trpc/server";
import { apiRate, apiToken, company } from "@orrn/db/schema";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import {
  API_RATE_PER_MINUTE,
  apiPageLimit,
  decodeApiCursor,
  encodeApiCursor,
  isModuleOn,
  type ApiTokenScope,
  type CompanyModule,
} from "@orrn/domain";
import { and, eq, sql } from "drizzle-orm";

import type { Context } from "../../context";
import type { OrrnDb } from "../atomic";
import type { Action } from "../permissions";
import { API_OPENAPI } from "./openapi";
import { hashApiSecret, parseApiToken, sameHex } from "./token";

export type ApiDeps = { db: OrrnDb; nowMs?: number };

type TokenCtx = {
  tokenId: string;
  companyId: string;
  scopes: ReadonlySet<ApiTokenScope>;
  modules: readonly string[];
};

const LAST_USED_STEP_MS = 60_000;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
const fail = (status: number, code: string, message: string, extra: Record<string, string> = {}) => json({ error: { code, message } }, status, extra);

/** The routes, in one table: the OpenAPI document is tested against it. */
export type Route = {
  pattern: RegExp;
  path: string;
  scope: ApiTokenScope;
  module: CompanyModule;
  run: (caller: Caller, args: RouteArgs) => Promise<unknown>;
};
type RouteArgs = { params: string[]; query: URLSearchParams; offset: number; limit: number; prices: boolean };
// The router's caller; typed loosely here so this module never imports the routers statically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Caller = any;

const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : typeof v === "number" ? new Date(v).toISOString() : String(v));
const q = (query: URLSearchParams, key: string, max = 100) => {
  const v = query.get(key);
  return v && v.length <= max ? v : undefined;
};
const page = <T>(items: T[], offset: number, limit: number, more: boolean) => ({
  data: items,
  nextCursor: more ? encodeApiCursor(offset + limit) : null,
});

export const ROUTES: Route[] = [
  {
    path: "/api/v1/orders",
    pattern: /^\/api\/v1\/orders$/,
    scope: "orders.read",
    module: "orders",
    run: async (caller, { query, offset, limit }) => {
      const status = q(query, "status", 20);
      const res = await caller.orders.list({
        limit,
        offset,
        ...(status ? { status } : {}),
        ...(q(query, "customerId", 64) ? { customerId: q(query, "customerId", 64) } : {}),
        ...(q(query, "from", 10) ? { dateFrom: q(query, "from", 10) } : {}),
        ...(q(query, "to", 10) ? { dateTo: q(query, "to", 10) } : {}),
      });
      const items = (res.items as Record<string, unknown>[]).map((o) => ({
        id: s(o.id),
        number: s(o.number),
        status: s(o.status),
        customerId: s(o.customerId),
        customerName: s(o.customerName),
        poNumber: s(o.poNumber),
        orderDate: s(o.orderDate),
        expectedDate: s(o.expectedDate),
        lines: n(o.lines),
        orderedG: n(o.orderedG),
        producedG: n(o.producedG),
        dispatchedG: n(o.dispatchedG),
        balanceG: n(o.bakiG),
        lateDays: n(o.lateDays),
      }));
      return page(items, offset, limit, res.nextOffset != null);
    },
  },
  {
    path: "/api/v1/orders/{id}",
    pattern: /^\/api\/v1\/orders\/([0-9A-Za-z_-]{1,64})$/,
    scope: "orders.read",
    module: "orders",
    run: async (caller, { params, prices }) => {
      const res = await caller.orders.get({ id: params[0] });
      const o = res.order as Record<string, unknown>;
      const details = new Map(((res.lineDetails ?? []) as Record<string, unknown>[]).map((d) => [String(d.lineId ?? d.id), d]));
      return {
        data: {
          id: s(o.id),
          number: s(o.number),
          status: s(o.status),
          customerId: s(o.customerId),
          customerName: s(o.customerName),
          poNumber: s(o.poNumber),
          orderDate: s(o.orderDate),
          expectedDate: s(o.expectedDate),
          lateDays: n(res.lateDays),
          lines: (res.lines as Record<string, unknown>[]).map((l) => {
            const d = details.get(String(l.lineId));
            return {
              id: s(l.lineId),
              lineNo: n(l.lineNo),
              sectionId: s(l.sectionId),
              sectionCode: s(l.sectionCode),
              sectionName: s(l.sectionName),
              cutLengthMm: n(l.cutLengthMm),
              finish: s(l.finish),
              orderedG: n(l.orderedG),
              orderedPcs: n(l.orderedPcs),
              producedG: n(l.producedG),
              dispatchedG: n(l.dispatchedG),
              balanceG: n(l.bakiG),
              ...(prices ? { ratePaise: n(d?.ratePaise) } : {}),
            };
          }),
        },
      };
    },
  },
  {
    path: "/api/v1/stock",
    pattern: /^\/api\/v1\/stock$/,
    scope: "stock.read",
    module: "bundles",
    run: async (caller, { query, offset, limit }) => {
      const res = await caller.stock.byDieLength({ limit, offset, includeReserved: true, ...(q(query, "sectionId", 64) ? { dieId: q(query, "sectionId", 64) } : {}) });
      const items = (res.items as Record<string, unknown>[]).map((r) => ({
        sectionId: s(r.dieId),
        sectionCode: s(r.sectionCode),
        sectionName: s(r.name),
        lengthMm: n(r.lengthMm),
        bundles: n(r.bundles),
        pcs: n(r.pcs),
        weightG: n(r.weightG),
        reservedBundles: n(r.reserved),
        oldestAt: iso(r.oldestAt),
      }));
      return page(items, offset, limit, res.nextOffset != null);
    },
  },
  {
    path: "/api/v1/stock/locations",
    pattern: /^\/api\/v1\/stock\/locations$/,
    scope: "stock.read",
    module: "bundles",
    run: async (caller, { query }) => {
      const res = await caller.stock.byYard({ includeReserved: true, ...(q(query, "sectionId", 64) ? { dieId: q(query, "sectionId", 64) } : {}) });
      const yard = (y: Record<string, unknown>) => ({
        locationId: s(y.locationId ?? y.id),
        code: s(y.code),
        name: s(y.name),
        bundles: n(y.bundles),
        pcs: n(y.pcs),
        weightG: n(y.weightG),
        reservedBundles: n(y.reserved),
        sections: n(y.sections),
      });
      const rows = (res.yards as Record<string, unknown>[]).map(yard);
      if (res.unplaced) rows.push(yard(res.unplaced as Record<string, unknown>));
      return { data: rows, nextCursor: null };
    },
  },
  {
    path: "/api/v1/dispatches",
    pattern: /^\/api\/v1\/dispatches$/,
    scope: "dispatch.read",
    module: "dispatches",
    run: async (caller, { query, offset, limit }) => {
      const status = q(query, "status", 20);
      const res = await caller.dispatch.listDispatches({
        limit: limit + 1,
        offset,
        ...(status ? { status } : {}),
        ...(q(query, "customerId", 64) ? { customerId: q(query, "customerId", 64) } : {}),
      });
      const all = res.items as Record<string, unknown>[];
      const items = all.slice(0, limit).map((d) => ({
        id: s(d.id),
        code: s(d.code),
        status: s(d.status),
        shipDay: s(d.shipDay),
        completedAt: iso(d.completedAt),
        packingListNumber: s(d.plNumber),
        vehicleNo: s(d.vehicleNo),
        invoiceNumber: s(d.invoiceNumber),
        customerId: s(d.customerId),
        customerName: s(d.customerName),
        orderId: s(d.salesOrderId),
        orderNumber: s(d.salesOrderNumber),
        bundles: n(d.itemCount),
        pcs: n(d.totalQuantity),
        weightG: n(d.totalWeightG),
      }));
      return page(items, offset, limit, all.length > limit);
    },
  },
  {
    path: "/api/v1/dispatches/{id}",
    pattern: /^\/api\/v1\/dispatches\/([0-9A-Za-z_-]{1,64})$/,
    scope: "dispatch.read",
    module: "dispatches",
    run: async (caller, { params }) => {
      const res = await caller.dispatch.getDispatch({ id: params[0] });
      const d = res.dispatch as Record<string, unknown>;
      const pl = (await caller.packingList.byDispatch({ dispatchId: params[0] })) as Record<string, unknown> | null;
      return {
        data: {
          id: s(d.id),
          code: s(d.code),
          status: s(d.status),
          shipDay: s(res.shipDay),
          completedAt: iso(d.completedAt),
          vehicleNo: s(d.vehicleNo),
          invoiceNumber: s(d.invoiceNumber),
          customerId: s(d.customerId),
          customerName: s((res.customer as Record<string, unknown> | null)?.name),
          packingList: pl ? { id: s(pl.id), number: s(pl.code), revision: n(pl.revision), createdAt: iso(pl.createdAt) } : null,
          bundles: (res.items as Record<string, unknown>[]).map((i) => ({
            id: s(i.bundleId),
            serial: s(i.serial),
            sectionId: s(i.dieId),
            sectionCode: s(i.dieSectionCode),
            lengthMm: n(i.lengthMm),
            pcs: n(i.quantity),
            weightG: n(i.weightG),
            orderId: s(i.orderId),
            orderNumber: s(i.orderNumber),
            lineNo: n(i.lineNo),
            poNumber: s(i.poNumber),
          })),
        },
      };
    },
  },
  {
    path: "/api/v1/invoices",
    pattern: /^\/api\/v1\/invoices$/,
    scope: "invoices.read",
    module: "billing",
    run: async (caller, { query, offset, limit, prices }) => {
      // The invoice list takes no offset: it is read up to 200 rows deep, then narrow with from/to.
      const want = Math.min(200, offset + limit + 1);
      const status = q(query, "status", 20);
      const rows = (await caller.billing.invoices.list({
        limit: want,
        ...(status ? { status } : {}),
        ...(q(query, "customerId", 64) ? { customerId: q(query, "customerId", 64) } : {}),
        ...(q(query, "from", 10) ? { from: q(query, "from", 10) } : {}),
        ...(q(query, "to", 10) ? { to: q(query, "to", 10) } : {}),
      })) as Record<string, unknown>[];
      const items = rows.slice(offset, offset + limit).map((r) => ({
        id: s(r.id),
        kind: s(r.kind),
        status: s(r.status),
        number: s(r.number),
        invoiceDate: s(r.invoiceDate),
        customerId: s(r.customerId),
        weightG: n(r.weightG),
        irnStatus: s(r.irnStatus),
        ...(prices ? { taxablePaise: n(r.taxablePaise), totalPaise: n(r.totalPaise) } : {}),
      }));
      return page(items, offset, limit, rows.length > offset + limit && offset + limit < 200);
    },
  },
  {
    path: "/api/v1/invoices/{id}",
    pattern: /^\/api\/v1\/invoices\/([0-9A-Za-z_-]{1,64})$/,
    scope: "invoices.read",
    module: "billing",
    run: async (caller, { params, prices }) => {
      const r = (await caller.billing.invoices.get({ id: params[0] })) as Record<string, unknown>;
      const irn = (r.irn ?? {}) as Record<string, unknown>;
      const ewb = (r.ewb ?? {}) as Record<string, unknown>;
      return {
        data: {
          id: s(r.id),
          kind: s(r.kind),
          status: s(r.status),
          number: s(r.number),
          invoiceDate: s(r.invoiceDate),
          customerId: s(r.customerId),
          againstInvoiceId: s(r.againstInvoiceId),
          irn: { status: s(irn.status), irn: s(irn.irn), ackNo: s(irn.ackNo), ackDate: s(irn.ackDt) },
          ewayBill: { status: s(ewb.status), number: s(ewb.number), validUntil: iso(ewb.validUntil) },
          packingLists: ((r.sources ?? []) as Record<string, unknown>[]).map((x) => ({ id: s(x.packingListId), number: s(x.plCode), revision: n(x.plRevision) })),
          ...(prices ? { outstandingPaise: n(r.outstandingPaise), paidPaise: n(r.paidPaise), creditedPaise: n(r.creditedPaise) } : {}),
        },
      };
    },
  },
];

/** The actions a token's context holds: nothing but what its scopes need inside the read procedures. */
export function actionsForScopes(scopes: ReadonlySet<ApiTokenScope>): ReadonlySet<Action> {
  const out = new Set<Action>();
  if (scopes.has("prices.read")) out.add("order.price");
  if (scopes.has("invoices.read")) out.add("invoice.read");
  return out;
}

async function authenticate(db: OrrnDb, header: string | null, nowMs: number): Promise<TokenCtx | Response> {
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const parsed = parseApiToken(bearer);
  if (!parsed) return fail(401, "unauthorized", "Send a plant API token: Authorization: Bearer orrna_...");
  const row = await db
    .select({
      id: apiToken.id,
      companyId: apiToken.companyId,
      salt: apiToken.salt,
      tokenHash: apiToken.tokenHash,
      scopes: apiToken.scopes,
      expiresAt: apiToken.expiresAt,
      revokedAt: apiToken.revokedAt,
      lastUsedAt: apiToken.lastUsedAt,
      companyStatus: company.status,
      modules: company.modules,
    })
    .from(apiToken)
    .innerJoin(company, eq(company.id, apiToken.companyId))
    .where(eq(apiToken.id, parsed.tokenId))
    .get();
  const hash = await hashApiSecret(row?.salt ?? "0", parsed.secret);
  if (!row || !sameHex(hash, row.tokenHash)) return fail(401, "unauthorized", "This token is not valid");
  if (row.revokedAt) return fail(401, "unauthorized", "This token was revoked");
  if (row.expiresAt && row.expiresAt.getTime() <= nowMs) return fail(401, "unauthorized", "This token has expired");
  if (row.companyStatus !== "active") return fail(403, "forbidden", "This plant is not active");
  const modules = (row.modules as string[] | null) ?? [];
  if (!isModuleOn(modules, "api")) return fail(403, "module_off", "The plant API is off for this plant");

  // One conditional upsert reserves the call: no row comes back once the minute is full.
  const minute = Math.floor(nowMs / 60_000);
  const reserved = await db
    .insert(apiRate)
    .values({ tokenId: row.id, minute, count: 1 })
    .onConflictDoUpdate({ target: [apiRate.tokenId, apiRate.minute], set: { count: sql`${apiRate.count} + 1` }, setWhere: sql`${apiRate.count} < ${API_RATE_PER_MINUTE}` })
    .returning({ count: apiRate.count });
  if (reserved.length === 0) {
    return fail(429, "rate_limited", `At most ${API_RATE_PER_MINUTE} calls a minute per token`, { "retry-after": String(60 - Math.floor((nowMs / 1000) % 60)) });
  }
  if (!row.lastUsedAt || nowMs - row.lastUsedAt.getTime() >= LAST_USED_STEP_MS) {
    await db.update(apiToken).set({ lastUsedAt: new Date(nowMs) }).where(and(eq(apiToken.id, row.id), eq(apiToken.companyId, row.companyId)));
  }
  return { tokenId: row.id, companyId: row.companyId, scopes: new Set(row.scopes as ApiTokenScope[]), modules };
}

/** The request context a token's call runs with: a read-only stand-in member holding only the scope actions. */
export function tokenContext(db: OrrnDb, token: TokenCtx): Context {
  const role: CompanyRole = "viewer";
  const id = `api:${token.tokenId}`;
  return {
    auth: null,
    db,
    request: new Request("https://api.invalid/api/v1", { method: "GET" }),
    session: { user: { id, name: "Plant API", email: "api@orrn.invalid", image: null }, session: { id, userId: id, signInMethod: null } } as unknown as Context["session"],
    membership: { id, companyId: token.companyId, role, companyStatus: "active", requireStrongSignIn: false },
    companyId: token.companyId,
    role,
    actions: actionsForScopes(token.scopes),
    customRole: null,
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    impersonationHeaderRejected: false,
    companyHeaderRejected: false,
  } as Context;
}

function statusOf(e: unknown): Response {
  if (e instanceof TRPCError) {
    if (e.code === "NOT_FOUND") return fail(404, "not_found", "Not found");
    if (e.code === "FORBIDDEN") return fail(403, "forbidden", e.message);
    if (e.code === "BAD_REQUEST") return fail(400, "bad_request", "A query value is not valid");
  }
  console.error("api v1 failed", e instanceof Error ? e.name : "unknown");
  return fail(500, "error", "Something went wrong");
}

export async function handlePublicApi(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return fail(405, "method_not_allowed", "The plant API only reads (GET)", { allow: "GET" });
  if (url.pathname === "/api/v1/openapi.json") return json(API_OPENAPI);
  const route = ROUTES.find((r) => r.pattern.test(url.pathname));
  if (!route) return fail(404, "not_found", "No such endpoint. See /api/v1/openapi.json");

  const nowMs = deps.nowMs ?? Date.now();
  const token = await authenticate(deps.db, request.headers.get("authorization"), nowMs);
  if (token instanceof Response) return token;
  if (!token.scopes.has(route.scope)) return fail(403, "scope", `This token has no ${route.scope} scope`);
  if (!isModuleOn(token.modules, route.module)) return fail(403, "module_off", "That module is not on for this plant");

  const offset = decodeApiCursor(url.searchParams.get("cursor"));
  const limit = apiPageLimit(url.searchParams.get("limit"));
  if (offset === null || limit === null) return fail(400, "bad_request", "cursor or limit is not valid");
  const params = route.pattern.exec(url.pathname)!.slice(1);

  try {
    const { appRouter } = await import("../../routers/index");
    const caller = appRouter.createCaller(tokenContext(deps.db, token));
    const body = await route.run(caller, { params, query: url.searchParams, offset, limit, prices: token.scopes.has("prices.read") });
    return json(body);
  } catch (e) {
    return statusOf(e);
  }
}
