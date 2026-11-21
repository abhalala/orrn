/**
 * `POST /buddy/chat` (design 2026-11-18, §4.1, §13): the bubble's chat leg, proxied to Hermes.
 *
 * Who: a browser session with an active membership, a role that may use the buddy, no impersonation,
 * and (in a plant that requires it) a secure sign-in. Otherwise 403. A stage without the four
 * `HERMES_*` names, a plant not in `BUDDY_COMPANIES` or a person who has not connected Hermes: 404.
 * Neither carries a body.
 *
 * Hermes endpoint (checked against the hermes-agent v0.23.1 source, `gateway/platforms/
 * api_server_openai_routes.py` and `api_server_response_admissions.py`): `POST /v1/responses` with
 * `stream: true` and `conversation: <name>`. Hermes keeps the conversation server-side (its response
 * store maps the name to the latest response and replays that history), so orrn stores no chat text and
 * the browser sends only the new message. The name is built here from the plant, the person and the
 * browser's conversation id, so one browser can never continue another person's conversation. The path is
 * `/p/<profile>/v1/responses` with the profile from the person's `buddy_link` (the buddy's own profile,
 * `orrn-buddy` by default; owner decision 2026-11-20).
 *
 * Hermes's SSE is normalised into orrn's own events and everything else is dropped (reasoning,
 * commentary items, `hermes.status`, tool outputs):
 *   {"type":"text","delta"} {"type":"tool","path"} {"type":"draft","draftId"}
 *   {"type":"done","conversationId"} {"type":"error","code":"offline"|"rate_limited"|"error"}
 * Draft events come from `buddy_draft` rows this person's grant made during the turn, not from parsing
 * Hermes's rendering of a tool result.
 */
import { isStrongSession } from "@orrn/auth/session-method";
import { buddyDraft, buddyGrant, company } from "@orrn/db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Context } from "../../context";
import { now } from "../clock";
import { DEFAULT_TIMEZONE } from "../dayWindow";
import { buddyAccess, buddyEnv, requestOriginAllowed } from "./access";
import { BUDDY_LIMIT, finishBuddyCall, logBuddyCall, reserveBuddyCall } from "./callLog";
import { hermesChatUrl, resolveHermesConfig } from "./config";

export const chatBodySchema = z.strictObject({
  conversationId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
  message: z.string().trim().min(1).max(4000),
  screen: z.string().max(300),
});

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; path: string }
  | { type: "draft"; draftId: string }
  | { type: "done"; conversationId: string }
  | { type: "error"; code: "offline" | "rate_limited" | "error" };

/** Time to wait for Hermes to answer with headers. */
export const HERMES_CONNECT_TIMEOUT_MS = 30_000;
/** A whole turn (Hermes tool loops may take minutes); matches nginx `proxy_read_timeout` 300 s (§4.1). */
export const HERMES_TURN_TIMEOUT_MS = 300_000;

export type ChatDeps = {
  fetch?: typeof fetch;
  /** Tests: shorter timeouts. */
  connectTimeoutMs?: number;
  turnTimeoutMs?: number;
};

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
};

const empty = (status: 403 | 404 | 400) => new Response(null, { status });

function frame(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function newConversationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function todayIn(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }
}

/** The context block Hermes gets with each turn (as `instructions`, never as user text). No tokens. */
export function contextBlock(input: {
  name: string;
  company: string;
  role: string;
  today: string;
  screen: string;
  notes: readonly string[];
}): string {
  const lines = [
    "You are the orrn buddy, in a chat window inside orrn (the plant's ERP). Use the orrn-buddy skill.",
    `The person: ${oneLine(input.name, 120)}. Plant: ${oneLine(input.company, 120)}. Role: ${input.role}.`,
    `Today in plant time: ${input.today}. The person is on the screen ${oneLine(input.screen, 300) || "/"}.`,
    "Reach orrn only through the orrn tools. Changes come back as drafts the person confirms in orrn.",
  ];
  if (input.notes.length > 0) {
    lines.push("What happened to drafts since the last turn (from orrn, final):");
    for (const n of input.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

/** One line of plain text: line breaks and other control characters become spaces, then cut. */
function oneLine(text: string, max: number): string {
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Drafts decided longer ago than this are never noted (a person back after a month gets no backlog). */
const NOTE_WINDOW_MS = 48 * 60 * 60 * 1000;
/** At most this many notes a turn; the rest wait for the next turn. */
const NOTES_PER_TURN = 20;

type NoteRow = {
  id: string;
  summary: string;
  status: string;
  kind: string;
  expiresAt: Date;
  resultJson: unknown;
};

/**
 * The server's notes (decision 7, review S4, S5): the final state of this person's drafts in this plant that Hermes
 * has not been told yet (`noted_at` null), wherever they were decided (the bubble or Settings > Buddy). A pending draft
 * past its 24 hours counts as expired. A dry run's report (`result.report`, D's `buddy.drafts.report`) rides on its
 * draft's note. Only the state, the draft's own title and the report outcome go to Hermes: never a result, never a
 * failure text.
 */
async function pendingNotes(db: Context["db"], companyId: string, userId: string, at: Date): Promise<{ rows: NoteRow[]; lines: string[] }> {
  const since = new Date(at.getTime() - NOTE_WINDOW_MS);
  const rows = await db
    .select({
      id: buddyDraft.id,
      summary: buddyDraft.summary,
      status: buddyDraft.status,
      kind: buddyDraft.kind,
      expiresAt: buddyDraft.expiresAt,
      resultJson: buddyDraft.resultJson,
    })
    .from(buddyDraft)
    .where(and(eq(buddyDraft.companyId, companyId), eq(buddyDraft.requestedByUserId, userId), isNull(buddyDraft.notedAt), noteDue(at, since)))
    .orderBy(asc(buddyDraft.createdAt))
    .limit(NOTES_PER_TURN);
  const lines = rows.map((r) => {
    const state = r.status === "pending" ? "expired" : r.status;
    const report = (r.resultJson as { report?: { outcome?: unknown; summary?: unknown } } | null)?.report;
    const tail =
      r.kind === "dryRun" && report && typeof report.outcome === "string"
        ? `; dry run ${oneLine(report.outcome, 20)}${typeof report.summary === "string" && report.summary.trim() ? `: ${oneLine(report.summary, 200)}` : ""}`
        : "";
    return `draft ${r.id} (${oneLine(r.summary, 120)}): ${state}${tail}`;
  });
  return { rows, lines };
}

/**
 * A draft whose state is final: decided in the note window, or pending past its 24 hours (lapsed in the window) with no
 * claim on it.
 */
function noteDue(at: Date, since: Date) {
  return or(
    and(inArray(buddyDraft.status, ["confirmed", "rejected", "expired", "failed"]), gte(buddyDraft.decidedAt, since)),
    // A claimed one is a confirm whose outcome is not known yet: it waits until it settles.
    and(eq(buddyDraft.status, "pending"), isNull(buddyDraft.claimedAt), lte(buddyDraft.expiresAt, at), gte(buddyDraft.expiresAt, since)),
  );
}

/**
 * Marks the notes Hermes took. Each row is marked only while it still reads as it did when the note was written
 * (same status, same report state), so a report that lands meanwhile is noted next turn.
 */
async function markNoted(db: Context["db"], companyId: string, rows: NoteRow[], at: Date): Promise<void> {
  if (rows.length === 0) return;
  const reported = (r: NoteRow) => Boolean((r.resultJson as { report?: unknown } | null)?.report);
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.status}|${reported(r) ? 1 : 0}`;
    groups.set(key, [...(groups.get(key) ?? []), r.id]);
  }
  for (const [key, ids] of groups) {
    const [status, rep] = key.split("|") as [NoteRow["status"], string];
    const reportState = rep === "1" ? sql`json_extract(${buddyDraft.resultJson}, '$.report') is not null` : sql`json_extract(${buddyDraft.resultJson}, '$.report') is null`;
    await db
      .update(buddyDraft)
      .set({ notedAt: at })
      .where(
        and(
          eq(buddyDraft.companyId, companyId),
          inArray(buddyDraft.id, ids),
          isNull(buddyDraft.notedAt),
          eq(buddyDraft.status, status as (typeof buddyDraft.status.enumValues)[number]),
          reportState,
        ),
      );
  }
}

type ParsedFrame = { event: string | null; data: string };

/** Split an SSE byte stream into frames (`event:` + `data:` lines, blank line ends a frame). */
export async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<ParsedFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event: string | null = null;
        const data: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length > 0 || event) yield { event, data: data.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Hermes names MCP tools `mcp__<server>__<tool>`; the server key in CT 230's config is `orrn`. */
const ORRN_CALL = /(^|__)orrn_call$/;

/** One Hermes frame -> orrn events. Unknown and dropped frames give none. */
export function normaliseFrame(f: ParsedFrame): ChatEvent[] | "completed" | "failed" {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(f.data) as Record<string, unknown>;
  } catch {
    return [];
  }
  const type = (typeof data.type === "string" ? data.type : f.event) ?? "";
  if (type === "response.output_text.delta" && typeof data.delta === "string") return [{ type: "text", delta: data.delta }];
  if (type === "response.completed") return "completed";
  if (type === "response.failed" || type === "response.incomplete" || type === "error") return "failed";
  if (type === "response.output_item.added") {
    const item = data.item as { type?: unknown; name?: unknown; arguments?: unknown } | undefined;
    if (item?.type === "function_call" && typeof item.name === "string" && ORRN_CALL.test(item.name)) {
      try {
        const args = JSON.parse(typeof item.arguments === "string" ? item.arguments : "{}") as { path?: unknown };
        if (typeof args.path === "string" && /^[A-Za-z0-9_.]{1,200}$/.test(args.path)) return [{ type: "tool", path: args.path }];
      } catch {
        return [];
      }
    }
  }
  return [];
}

/** The person's newest live grant here (to scope draft events and the chat log row), if any. */
async function liveGrantId(ctx: Context & { companyId: string }, userId: string): Promise<string | null> {
  const g = await ctx.db
    .select({ id: buddyGrant.id })
    .from(buddyGrant)
    .where(and(eq(buddyGrant.companyId, ctx.companyId), eq(buddyGrant.userId, userId), isNull(buddyGrant.revokedAt)))
    .orderBy(desc(buddyGrant.createdAt))
    .get();
  return g?.id ?? null;
}

/** `application/json` (any parameters). Anything else could be a cross-site form, which needs no preflight. */
function isJsonBody(request: Request): boolean {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  return type === "application/json";
}

export async function handleBuddyChat(request: Request, ctx: Context, deps: ChatDeps = {}): Promise<Response> {
  if (request.method !== "POST") return empty(404);
  // Cross-site requests (security H1): only a JSON body (which forces a CORS preflight) from an allowed web origin.
  if (!isJsonBody(request) || !requestOriginAllowed(request)) return empty(403);
  if (!ctx.session || ctx.impersonation || ctx.impersonationHeaderRejected || ctx.companyHeaderRejected) return empty(403);
  if (!ctx.companyId || !ctx.membership || !ctx.role) return empty(403);
  const access = await buddyAccess(ctx);
  if (!access.person) return empty(403);
  if (!access.configured || !access.listed || !access.link) return empty(404);
  if (ctx.membership.requireStrongSignIn === true) {
    const method = (ctx.session.session as { signInMethod?: unknown } | undefined)?.signInMethod;
    if (!isStrongSession(method)) return empty(403);
  }
  const cfg = resolveHermesConfig(buddyEnv());
  if (!cfg.ok) return empty(404);

  const parsed = chatBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return empty(400);
  const body = parsed.data;

  const companyId = ctx.companyId;
  const userId = ctx.session.user.id;
  const grantId = await liveGrantId({ ...ctx, companyId }, userId);
  const started = now();
  const conversationId = body.conversationId ?? newConversationId();

  // One conditional insert counts and reserves the turn (security L2), so turns sent at once cannot all pass.
  const reserved = await reserveBuddyCall(ctx.db, { companyId, userId, grantId, tool: "chat" }, BUDDY_LIMIT.chatTurns);
  if (!reserved.ok) {
    await logBuddyCall(ctx.db, { companyId, userId, grantId, tool: "chat", outcome: "rate_limited", ms: 0 });
    return new Response(frame({ type: "error", code: "rate_limited" }), { status: 200, headers: SSE_HEADERS });
  }
  const callId = reserved.id;

  const plant = await ctx.db.select({ name: company.name, settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
  const notes = await pendingNotes(ctx.db, companyId, userId, started);
  const tz = (plant?.settings as { timezone?: unknown } | null)?.timezone;
  const instructions = contextBlock({
    name: ctx.session.user.name,
    company: plant?.name ?? "",
    role: ctx.role,
    today: todayIn(typeof tz === "string" ? tz : DEFAULT_TIMEZONE, started),
    screen: body.screen,
    notes: notes.lines,
  });
  // The buddy's own profile from the person's link (never the default profile, never from the browser).
  const url = hermesChatUrl(cfg.baseUrl, access.link.hermesProfile);
  if (!url) return empty(404);
  const doFetch = deps.fetch ?? fetch;
  const turnTimeout = AbortSignal.timeout(deps.turnTimeoutMs ?? HERMES_TURN_TIMEOUT_MS);
  const connect = new AbortController();
  const connectTimer = setTimeout(() => connect.abort(), deps.connectTimeoutMs ?? HERMES_CONNECT_TIMEOUT_MS);

  let upstream: Response | null = null;
  try {
    upstream = await doFetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.any([turnTimeout, connect.signal]),
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        ...cfg.accessHeaders,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        input: body.message,
        instructions,
        conversation: `orrn:${companyId}:${userId}:${conversationId}`,
        stream: true,
        store: true,
      }),
    });
  } catch {
    upstream = null;
  } finally {
    clearTimeout(connectTimer);
  }

  const contentType = upstream?.headers.get("content-type") ?? "";
  // A bad Access token answers a login page (200 HTML or a redirect), not an error: anything that is not a
  // 2xx event stream is "offline".
  if (!upstream || !upstream.ok || !contentType.startsWith("text/event-stream") || !upstream.body) {
    await finishBuddyCall(ctx.db, callId, { outcome: "error", ms: now().getTime() - started.getTime() });
    try {
      await upstream?.body?.cancel();
    } catch {
      // nothing to cancel
    }
    return new Response(frame({ type: "error", code: "offline" }), { status: 200, headers: SSE_HEADERS });
  }

  const db = ctx.db;
  const upstreamBody = upstream.body;
  // Hermes took the turn, so it has the notes: mark them, so the next turn does not repeat them. A failure here only
  // means the notes come again.
  try {
    await markNoted(db, companyId, notes.rows, now());
  } catch {
    // the notes come again next turn
  }
  const seenDrafts = new Set<string>();
  const newDrafts = async (): Promise<ChatEvent[]> => {
    if (!grantId) return [];
    const rows = await db
      .select({ id: buddyDraft.id })
      .from(buddyDraft)
      .where(
        and(
          eq(buddyDraft.companyId, companyId),
          eq(buddyDraft.requestedByUserId, userId),
          eq(buddyDraft.grantId, grantId),
          gte(buddyDraft.createdAt, started),
        ),
      )
      .orderBy(asc(buddyDraft.createdAt))
      .limit(50);
    const out: ChatEvent[] = [];
    for (const r of rows) {
      if (seenDrafts.has(r.id)) continue;
      seenDrafts.add(r.id);
      out.push({ type: "draft", draftId: r.id });
    }
    return out;
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(frame(e)));
      let outcome: "ok" | "error" = "error";
      try {
        let finished = false;
        for await (const f of sseFrames(upstreamBody)) {
          const r = normaliseFrame(f);
          if (r === "completed") {
            for (const d of await newDrafts()) send(d);
            send({ type: "done", conversationId });
            outcome = "ok";
            finished = true;
            break;
          }
          if (r === "failed") {
            for (const d of await newDrafts()) send(d);
            send({ type: "error", code: "error" });
            finished = true;
            break;
          }
          for (const e of r) send(e);
          // A tool output just landed: a draft may have been made.
          const t = (() => {
            try {
              return (JSON.parse(f.data) as { type?: string; item?: { type?: string } }) ?? {};
            } catch {
              return {};
            }
          })();
          if (t.type === "response.output_item.done" && t.item?.type === "function_call_output") {
            for (const d of await newDrafts()) send(d);
          }
        }
        if (!finished) {
          for (const d of await newDrafts()) send(d);
          send({ type: "error", code: "offline" });
        }
      } catch {
        try {
          send({ type: "error", code: turnTimeout.aborted ? "offline" : "error" });
        } catch {
          // the browser went away
        }
      } finally {
        try {
          await upstreamBody.cancel();
        } catch {
          // already closed
        }
        try {
          await finishBuddyCall(db, callId, { outcome, ms: now().getTime() - started.getTime() });
        } catch {
          // the log must never break the answer
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
