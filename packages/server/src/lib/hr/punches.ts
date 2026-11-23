/**
 * XE parity lane HR, row 93: biometric punches. A device export file (columns mapped once per device) and
 * an HTTP push from a device both land here: punches insert with duplicates ignored (device + person code
 * + time), then each person's punches around the touched days pair into in/out by the plant's shifts
 * (`pairPunches`, pure) and write attendance rows marked `punch`. A row a person marked by hand (manual
 * or leave) is never overwritten by a punch.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { hrAttendance, hrDevice, hrEmployee, hrPunch } from "@orrn/db/schema/hr";
import { payRun } from "@orrn/db/schema/hr";
import { addDaysYmd, attendanceFigures, pairPunches, statusFromSpan, shiftLengthMin, ymdOfLocal, type ParsedPunch } from "@orrn/domain";

import { atomicBatch, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../atomic";
import { now } from "../clock";
import { localOf, plantClock, rulesFor, type PlantClock } from "./core";

export const PUSH_MAX_PUNCHES = 500;

export type UtcPunch = { code: string; utcMs: number };

/** Local wall time of a file line to UTC in the plant's zone. */
export function fileToUtc(clock: Pick<PlantClock, "timezone">, punches: readonly ParsedPunch[]): UtcPunch[] {
  return punches.map((p) => {
    // The zone offset at the local time, applied twice so a change of offset settles (same as zonedWallMs).
    const guess = p.localMs - (localOf(clock, p.localMs) - p.localMs);
    const utcMs = p.localMs - (localOf(clock, guess) - guess);
    return { code: p.code, utcMs };
  });
}

export type ImportResult = { inserted: number; duplicates: number; unknownCodes: string[]; daysWritten: number };

/** Insert punches (duplicates ignored) and rebuild the punch attendance of the people they touch. */
export async function importPunches(db: OrrnDb, companyId: string, deviceId: string, punches: readonly UtcPunch[], source: "file" | "push", actorId: string | null): Promise<ImportResult> {
  if (!punches.length) return { inserted: 0, duplicates: 0, unknownCodes: [], daysWritten: 0 };
  const clock = await plantClock(db, companyId);
  const seen = new Set<string>();
  const unique = punches.filter((p) => {
    const k = `${p.code}|${p.utcMs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const before = await countPunches(db, companyId, deviceId);
  const stmts: SqliteBatchItem[] = [];
  const createdAt = now();
  pushChunkedInserts(
    stmts,
    (rows) => db.insert(hrPunch).values(rows).onConflictDoNothing(),
    unique.map((p) => ({ id: crypto.randomUUID(), companyId, deviceId, deviceCode: p.code, at: new Date(p.utcMs), source, createdAt })),
  );
  stmts.push(db.update(hrDevice).set({ lastPushAt: createdAt }).where(and(eq(hrDevice.companyId, companyId), eq(hrDevice.id, deviceId))));
  await atomicBatch(db, stmts);
  const inserted = (await countPunches(db, companyId, deviceId)) - before;

  const codes = [...new Set(unique.map((p) => p.code))];
  const people = await db
    .select({ id: hrEmployee.id, code: hrEmployee.deviceCode, shiftId: hrEmployee.shiftId, joinedOn: hrEmployee.joinedOn, leftOn: hrEmployee.leftOn })
    .from(hrEmployee)
    .where(and(eq(hrEmployee.companyId, companyId), inArray(hrEmployee.deviceCode, codes.slice(0, 90))));
  const known = new Map(people.map((p) => [p.code!, p]));
  const unknownCodes = codes.filter((c) => !known.has(c));
  let daysWritten = 0;
  for (const code of codes) {
    const person = known.get(code);
    if (!person) continue;
    const times = unique.filter((p) => p.code === code).map((p) => p.utcMs);
    daysWritten += await rebuildPunchDays(db, companyId, clock, person, Math.min(...times), Math.max(...times), actorId);
  }
  return { inserted, duplicates: unique.length - inserted + (punches.length - unique.length), unknownCodes, daysWritten };
}

async function countPunches(db: OrrnDb, companyId: string, deviceId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(hrPunch).where(and(eq(hrPunch.companyId, companyId), eq(hrPunch.deviceId, deviceId)));
  return Number(r?.n ?? 0);
}

async function lockedMonths(db: OrrnDb, companyId: string): Promise<Set<string>> {
  const rows = await db.select({ month: payRun.month }).from(payRun).where(and(eq(payRun.companyId, companyId), eq(payRun.status, "locked"))).limit(400);
  return new Set(rows.map((r) => r.month));
}

async function rebuildPunchDays(
  db: OrrnDb,
  companyId: string,
  clock: PlantClock,
  person: { id: string; code: string | null; joinedOn: string; leftOn: string | null },
  fromUtc: number,
  toUtc: number,
  actorId: string | null,
): Promise<number> {
  // A day's punches may start the evening before the first new punch and end the morning after the last.
  const windowFrom = new Date(fromUtc - 36 * 3_600_000);
  const windowTo = new Date(toUtc + 36 * 3_600_000);
  const rows = await db
    .select({ at: hrPunch.at })
    .from(hrPunch)
    .where(and(eq(hrPunch.companyId, companyId), eq(hrPunch.deviceCode, person.code!), gte(hrPunch.at, windowFrom), lte(hrPunch.at, windowTo)))
    .limit(2000);
  const firstDay = addDaysYmd(ymdOfLocal(localOf(clock, fromUtc)), -1);
  const lastDay = ymdOfLocal(localOf(clock, toUtc));
  const days = pairPunches(
    rows.map((r) => localOf(clock, r.at.getTime())),
    clock.shifts,
  ).filter((d) => d.day >= firstDay && d.day <= lastDay && d.day >= person.joinedOn && (!person.leftOn || d.day <= person.leftOn));
  if (!days.length) return 0;
  const locked = await lockedMonths(db, companyId);
  const { value: rules } = await rulesFor(db, companyId, lastDay.slice(0, 7));
  const rule = { minMinutes: rules.overtimeMinMinutes, stepMinutes: rules.overtimeStepMinutes };
  const markedAt = now();
  const values = days
    .filter((d) => !locked.has(d.day.slice(0, 7)))
    .map((d) => {
      const shift = clock.shifts.find((s) => s.id === d.shiftId) ?? null;
      const inUtc = d.inMs - (localOf(clock, d.inMs) - d.inMs);
      const outUtc = d.outMs === null ? null : d.outMs - (localOf(clock, d.outMs) - d.outMs);
      const fig = attendanceFigures(d.inMs, d.outMs, shift, rule);
      return {
        id: crypto.randomUUID(),
        companyId,
        employeeId: person.id,
        day: d.day,
        status: statusFromSpan(fig.workedMin, shift ? shiftLengthMin(shift) : 8 * 60),
        shiftId: d.shiftId,
        inAt: new Date(inUtc),
        outAt: outUtc === null ? null : new Date(outUtc),
        workedMin: fig.workedMin,
        overtimeMin: fig.overtimeMin,
        source: "punch" as const,
        markedBy: actorId,
        markedAt,
      };
    });
  const stmts: SqliteBatchItem[] = [];
  pushChunkedInserts(
    stmts,
    (part) =>
      db
        .insert(hrAttendance)
        .values(part)
        .onConflictDoUpdate({
          target: [hrAttendance.companyId, hrAttendance.employeeId, hrAttendance.day],
          set: {
            status: sql`excluded.status`,
            shiftId: sql`excluded.shift_id`,
            inAt: sql`excluded.in_at`,
            outAt: sql`excluded.out_at`,
            workedMin: sql`excluded.worked_min`,
            overtimeMin: sql`excluded.overtime_min`,
            markedAt: sql`excluded.marked_at`,
          },
          setWhere: sql`${hrAttendance.source} = 'punch'`,
        }),
    values,
  );
  if (stmts.length) await atomicBatch(db, stmts);
  return values.length;
}

// ---------------------------------------------------------------------------
// Device push (HTTP). The make of the plant's devices is an owner item, so the one adapter today is
// orrn's own JSON shape (also the fake device in tests); a make's protocol plugs in as another adapter.
// ---------------------------------------------------------------------------

export const HR_PUNCH_PUSH_PATH = "/hr/v1/punches";

export interface PunchPushAdapter {
  readonly name: string;
  parse(body: string): { ok: true; punches: UtcPunch[] } | { ok: false; error: string };
}

/** `{ "punches": [{ "code": "101", "at": "2026-11-03T07:52:10+05:30" | 1793... }] }` */
export const orrnJsonAdapter: PunchPushAdapter = {
  name: "orrn-json",
  parse(body) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return { ok: false, error: "Body is not JSON" };
    }
    const list = (data as { punches?: unknown })?.punches;
    if (!Array.isArray(list)) return { ok: false, error: "Expected { punches: [...] }" };
    if (list.length > PUSH_MAX_PUNCHES) return { ok: false, error: `At most ${PUSH_MAX_PUNCHES} punches per call` };
    const punches: UtcPunch[] = [];
    for (const p of list) {
      const code = (p as { code?: unknown })?.code;
      const at = (p as { at?: unknown })?.at;
      const utcMs = typeof at === "number" ? at : typeof at === "string" && /[zZ]|[+-]\d{2}:?\d{2}$/.test(at) ? Date.parse(at) : NaN;
      if (typeof code !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(code) || !Number.isFinite(utcMs)) return { ok: false, error: "Each punch needs a code and a time with its zone" };
      punches.push({ code, utcMs });
    }
    return { ok: true, punches };
  },
};

export const PUNCH_PUSH_ADAPTERS: Record<string, PunchPushAdapter> = { [orrnJsonAdapter.name]: orrnJsonAdapter };

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The device push: the token names the device (and so the plant); never a company id from the body. */
export async function handleHrPunchPush(
  db: OrrnDb,
  req: { authorization: string | undefined; rawBody: string; adapter?: string },
): Promise<{ status: 200 | 400 | 401 | 403; body: Record<string, unknown> }> {
  const token = /^Bearer\s+(\S{16,200})$/.exec(req.authorization ?? "")?.[1];
  if (!token) return { status: 401, body: { error: "Unauthorized" } };
  const [device] = await db
    .select({ id: hrDevice.id, companyId: hrDevice.companyId, active: hrDevice.active })
    .from(hrDevice)
    .where(eq(hrDevice.tokenHash, await sha256Hex(token)))
    .limit(1);
  if (!device || !device.active) return { status: 401, body: { error: "Unauthorized" } };
  const { companyModules } = await import("../moduleGate");
  const { isModuleOn } = await import("@orrn/domain");
  if (!isModuleOn(await companyModules(db, device.companyId), "hr")) return { status: 403, body: { error: "HR is not on for this plant" } };
  const adapter = PUNCH_PUSH_ADAPTERS[req.adapter ?? orrnJsonAdapter.name];
  if (!adapter) return { status: 400, body: { error: "Unknown device format" } };
  const parsed = adapter.parse(req.rawBody);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const result = await importPunches(db, device.companyId, device.id, parsed.punches, "push", null);
  return { status: 200, body: { ok: true, inserted: result.inserted, duplicates: result.duplicates, unknownCodes: result.unknownCodes } };
}
