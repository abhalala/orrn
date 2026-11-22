/**
 * The owner's morning mail (XE parity lane REG, #82). The worker's hourly cron (alchemy.run.ts `crons`,
 * `apps/server` `scheduled`) calls `runMorningSummaries`. A plant with `settings.morningSummary.enabled`
 * gets one mail per plant-local day, in its chosen hour, to its owners and admins, with yesterday's
 * production-day figures (`morningFigures`, the same numbers as `reports.morning`). No rupee figure.
 *
 * - Once a day: before sending, the run claims the day with an audit row whose id is derived from the
 *   company and the plant-local date (`mis.morning.sent`). A second tick in the same hour, or a retry,
 *   finds the row and sends nothing. The figures and recipients are read before the claim, so a failed
 *   read leaves the day open; the claim comes before sending, so a failed send is not retried that day
 *   (at most once). The row's meta keeps the outcome.
 * - One plant failing never stops the others.
 * - The sender is injected so tests never send mail.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { auditLog } from "@orrn/db/schema/audit";
import { user } from "@orrn/db/schema/auth";
import { company, membership } from "@orrn/db/schema/tenant";
import { morningSummaryDue, morningSummaryLines, readMorningSummarySettings } from "@orrn/domain";

import type { OrrnDb } from "./atomic";
import { companyTimezone, zonedOffsetMs, zonedYmd } from "./dayWindow";
import type { SendEmailOptions } from "./email";
import { morningFigures } from "./regReports";

export type MorningSender = (mail: SendEmailOptions) => Promise<unknown>;
type Log = { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

export const MORNING_SUMMARY_ACTION = "mis.morning.sent";

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The id of the day's claim row: one per company and plant-local date. */
export function morningClaimId(companyId: string, localDate: string): string {
  return `morning-summary:${companyId}:${localDate}`;
}

export type MorningRunResult = { companyId: string; outcome: "sent" | "already" | "no recipients" | "failed"; recipients: number; error?: string };

export async function runMorningSummaries(db: OrrnDb, at: Date, send: MorningSender, log: Log = console): Promise<MorningRunResult[]> {
  const plants = await db
    .select({ id: company.id, name: company.name, settings: company.settings })
    .from(company)
    .where(and(eq(company.status, "active"), sql`json_extract(${company.settings}, '$.morningSummary.enabled') = 1`));
  const out: MorningRunResult[] = [];
  for (const p of plants) {
    const settings = (p.settings ?? {}) as Record<string, unknown>;
    const s = readMorningSummarySettings(settings.morningSummary);
    const tz = companyTimezone(settings);
    const ms = at.getTime();
    const localHour = new Date(ms + zonedOffsetMs(tz, ms)).getUTCHours();
    if (!morningSummaryDue(s, localHour)) continue;
    try {
      out.push(await sendOne(db, at, p.id, p.name, tz, send));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("morning summary failed", p.id, message);
      out.push({ companyId: p.id, outcome: "failed", recipients: 0, error: message });
    }
  }
  if (out.length) log.log("morning summaries", JSON.stringify(out.map((r) => ({ companyId: r.companyId, outcome: r.outcome, recipients: r.recipients }))));
  return out;
}

async function sendOne(db: OrrnDb, at: Date, companyId: string, name: string, tz: string, send: MorningSender): Promise<MorningRunResult> {
  const ymd = zonedYmd(tz, at.getTime());
  const localDate = `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`;
  const claimId = morningClaimId(companyId, localDate);
  // Read the figures before claiming the day: a failed read leaves the day unclaimed for the next tick.
  const figures = await morningFigures(db, companyId, at);
  const people = await db
    .select({ email: user.email })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.companyId, companyId), inArray(membership.role, ["owner", "admin"])));
  const to = [...new Set(people.map((r) => r.email).filter((e): e is string => typeof e === "string" && e.includes("@")))];
  const claimed = await db
    .insert(auditLog)
    .values({ id: claimId, companyId, action: MORNING_SUMMARY_ACTION, subjectType: "company", subjectId: companyId, meta: { localDate, state: "claimed" }, at })
    .onConflictDoNothing()
    .returning({ id: auditLog.id });
  if (claimed.length === 0) return { companyId, outcome: "already", recipients: 0 };

  const mark = (meta: Record<string, unknown>) => db.update(auditLog).set({ meta: { localDate, ...meta } }).where(eq(auditLog.id, claimId));
  if (to.length === 0) {
    await mark({ state: "no recipients" });
    return { companyId, outcome: "no recipients", recipients: 0 };
  }

  const lines = morningSummaryLines(name, figures);
  const subject = `${name}: ${figures.day} at a glance`;
  const text = lines.join("\n");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1f2328">${lines
    .map((l, i) => (i === 0 ? `<p style="font-weight:600">${escapeHtml(l)}</p>` : `<p style="margin:4px 0">${escapeHtml(l)}</p>`))
    .join("")}</body></html>`;

  const failures: string[] = [];
  for (const email of to) {
    try {
      await send({ to: email, subject, text, html });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  await mark({ state: failures.length === to.length ? "failed" : "sent", day: figures.day, recipients: to.length, failed: failures.length });
  if (failures.length === to.length) return { companyId, outcome: "failed", recipients: to.length, error: failures[0] };
  return { companyId, outcome: "sent", recipients: to.length };
}
