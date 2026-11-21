/**
 * The buddy call log and its rate limits (design 2026-11-18, §7). One append-only `buddy_call` row per
 * MCP tool call (refused and failed ones too) and per chat turn. No result bodies, no chat text.
 *
 * Limits (fix round 2026-11-20, security L2): 60 tool calls a minute and 30 chat turns an hour, each per person and
 * plant, whatever grant they use, so a new grant starts nothing at zero. `reserveBuddyCall` counts and inserts in one
 * conditional statement (a "pending" row), so parallel requests cannot all pass the count; `finishBuddyCall` sets the
 * real outcome when the call ends. Drafts (20 an hour per person and plant) are held by the draft insert itself.
 * Refused calls (`rate_limited` rows) never count. They are counted from the rows themselves, so no other table holds
 * state.
 */
import type { createDb } from "@orrn/db";
import { buddyCall, type BuddyCallOutcome } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

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

export type BuddyLimit = { max: number; windowMs: number };

/** The limits as `reserveBuddyCall` takes them. */
export const BUDDY_LIMIT = {
  toolCalls: { max: BUDDY_LIMITS.toolCallsPerMinute, windowMs: MINUTE },
  chatTurns: { max: BUDDY_LIMITS.chatTurnsPerHour, windowMs: HOUR },
  drafts: { max: BUDDY_LIMITS.draftsPerHour, windowMs: HOUR },
} as const satisfies Record<string, BuddyLimit>;

export type ReserveCall = {
  companyId: string;
  userId: string;
  grantId: string | null;
  /** `chat` for a chat turn; any other name is a tool call, and all tool calls share one count. */
  tool: string;
  path?: string | null;
  platform?: string | null;
};

/**
 * Reserves one call against the person's limit in this plant: a single `INSERT ... SELECT ... WHERE (count in the
 * window) < max`, so two requests at once cannot both take the last place, and a new grant changes nothing (the
 * count is keyed on company, person and tool class: `chat`, or every other tool). The row starts `pending`.
 */
export async function reserveBuddyCall(db: Db, call: ReserveCall, limit: BuddyLimit): Promise<{ ok: true; id: string } | { ok: false }> {
  const id = createId();
  const atMs = now().getTime();
  const sinceMs = atMs - limit.windowMs;
  const tool = call.tool.slice(0, 64);
  const toolClass = tool === "chat" ? sql`tool = 'chat'` : sql`tool <> 'chat'`;
  const rows = await db.all<{ id: string }>(sql`
    insert into buddy_call (id, company_id, user_id, grant_id, tool, path, outcome, ms, result_bytes, platform, at)
    select ${id}, ${call.companyId}, ${call.userId}, ${call.grantId}, ${tool}, ${call.path ? call.path.slice(0, 200) : null},
      'pending', 0, 0, ${call.platform ? call.platform.slice(0, 40) : null}, ${atMs}
    where (
      select count(*) from buddy_call
      where company_id = ${call.companyId} and user_id = ${call.userId} and ${toolClass}
        and outcome <> 'rate_limited' and at > ${sinceMs}
    ) < ${limit.max}
    returning id`);
  return rows.length > 0 ? { ok: true, id } : { ok: false };
}

/** Sets the real outcome of a reserved call. Only a `pending` row moves, so a finished row is never rewritten. */
export async function finishBuddyCall(
  db: Db,
  id: string,
  result: { outcome: Exclude<BuddyCallOutcome, "pending">; ms: number; resultBytes?: number },
): Promise<void> {
  await db
    .update(buddyCall)
    .set({ outcome: result.outcome, ms: Math.max(0, Math.round(result.ms)), resultBytes: Math.max(0, result.resultBytes ?? 0) })
    .where(and(eq(buddyCall.id, id), eq(buddyCall.outcome, "pending")));
}

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
