/**
 * The buddy call log and its rate limits (design 2026-11-18, §7). One append-only `buddy_call` row per
 * MCP tool call (refused and failed ones too) and per chat turn. No result bodies, no chat text.
 *
 * Limits: 60 tool calls a minute and 20 drafts an hour per grant; 30 chat turns an hour per person and
 * plant. They are counted from the rows themselves, so no other table holds state.
 */
import type { createDb } from "@orrn/db";
import { buddyCall, buddyDraft, type BuddyCallOutcome } from "@orrn/db/schema";
import { and, eq, gt, ne, sql, type SQL } from "drizzle-orm";

import { now } from "../clock";
import { createId } from "../id";

type Db = ReturnType<typeof createDb>;

export const BUDDY_LIMITS = {
  toolCallsPerMinute: 60,
  draftsPerHour: 20,
  chatTurnsPerHour: 30,
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type CallLogRow = {
  companyId: string;
  userId: string;
  grantId: string | null;
  tool: string;
  path?: string | null;
  outcome: BuddyCallOutcome;
  ms: number;
  resultBytes?: number;
  platform?: string | null;
};

export async function logBuddyCall(db: Db, row: CallLogRow): Promise<void> {
  await db.insert(buddyCall).values({
    id: createId(),
    companyId: row.companyId,
    userId: row.userId,
    grantId: row.grantId,
    tool: row.tool.slice(0, 64),
    path: row.path ? row.path.slice(0, 200) : null,
    outcome: row.outcome,
    ms: Math.max(0, Math.round(row.ms)),
    resultBytes: Math.max(0, row.resultBytes ?? 0),
    platform: row.platform ? row.platform.slice(0, 40) : null,
    at: now(),
  });
}

async function count(db: Db, where: SQL | undefined, table: typeof buddyCall | typeof buddyDraft): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)` }).from(table).where(where).get();
  return Number(r?.n ?? 0);
}

/** True when the grant made 60 tool calls in the last minute. */
export async function toolCallsLimited(db: Db, grantId: string): Promise<boolean> {
  const since = new Date(now().getTime() - MINUTE);
  const n = await count(db, and(eq(buddyCall.grantId, grantId), ne(buddyCall.tool, "chat"), gt(buddyCall.at, since)), buddyCall);
  return n >= BUDDY_LIMITS.toolCallsPerMinute;
}

/** True when the grant made 20 drafts in the last hour. */
export async function draftsLimited(db: Db, grantId: string): Promise<boolean> {
  const since = new Date(now().getTime() - HOUR);
  const n = await count(db, and(eq(buddyDraft.grantId, grantId), gt(buddyDraft.createdAt, since)), buddyDraft);
  return n >= BUDDY_LIMITS.draftsPerHour;
}

/** True when the person sent 30 chat turns in this plant in the last hour (refused turns do not count). */
export async function chatTurnsLimited(db: Db, companyId: string, userId: string): Promise<boolean> {
  const since = new Date(now().getTime() - HOUR);
  const n = await count(
    db,
    and(
      eq(buddyCall.companyId, companyId),
      eq(buddyCall.userId, userId),
      eq(buddyCall.tool, "chat"),
      ne(buddyCall.outcome, "rate_limited"),
      gt(buddyCall.at, since),
    ),
    buddyCall,
  );
  return n >= BUDDY_LIMITS.chatTurnsPerHour;
}
