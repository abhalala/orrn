/**
 * Pure model for the audit viewer (FP-PF-16): the filter shape in the URL, the kinds a person can
 * pick, and the conversion from a chosen date to the instant the server filters on. No React.
 */

/** Action prefixes the Kind filter offers (`dispatch.complete` is kind `dispatch`). */
export const AUDIT_KINDS = [
  "company",
  "member",
  "device",
  "dispatch",
  "bundle",
  "die",
  "customer",
  "stock",
  "order",
  "count",
  "support_request",
  "backup",
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export function isAuditKind(value: unknown): value is AuditKind {
  return typeof value === "string" && (AUDIT_KINDS as readonly string[]).includes(value);
}

export type AuditFilters = {
  actor?: string;
  kind?: AuditKind;
  subject?: string;
  /** `YYYY-MM-DD`, in the plant's time zone. */
  from?: string;
  to?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * `?actor=&kind=&subject=&from=&to=` to filters, dropping anything malformed. Plain checks, no zod:
 * the route's `validateSearch` sits in the entry chunk.
 */
export function parseAuditSearch(search: Record<string, unknown>): AuditFilters {
  const out: AuditFilters = {};
  if (typeof search.actor === "string" && search.actor && search.actor.length <= 64) out.actor = search.actor;
  if (isAuditKind(search.kind)) out.kind = search.kind;
  if (typeof search.subject === "string" && search.subject.trim() && search.subject.length <= 64) out.subject = search.subject.trim();
  if (isDay(search.from)) out.from = search.from;
  if (isDay(search.to)) out.to = search.to;
  return out;
}

/** Offset of `timeZone` from UTC at `utcMs`, in minutes (east positive). */
function offsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** The instant (epoch ms) a calendar date starts in `timeZone`: 24 Oct in Kolkata is 23 Oct 18:30 UTC. */
export function zonedDayStartMs(day: string, timeZone: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // One correction pass is enough for any real zone (the offset is read at the guess, then at the result).
  const first = guess - offsetMinutes(timeZone, guess) * 60_000;
  return guess - offsetMinutes(timeZone, first) * 60_000;
}

/** The last millisecond of a calendar date in `timeZone`. */
export function zonedDayEndMs(day: string, timeZone: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return zonedDayStartMs(next, timeZone) - 1;
}

/** What `audit.list` takes for these filters (the cursor and page size are added by the caller). */
export function auditInput(filters: AuditFilters, timeZone: string) {
  return {
    ...(filters.actor ? { actorId: filters.actor } : {}),
    ...(filters.kind ? { action: `${filters.kind}.` } : {}),
    ...(filters.subject ? { subjectId: filters.subject } : {}),
    ...(filters.from ? { from: zonedDayStartMs(filters.from, timeZone) } : {}),
    ...(filters.to ? { to: zonedDayEndMs(filters.to, timeZone) } : {}),
  };
}

/** The kind of an action code: `dispatch.complete` is `dispatch`; null when it is not one the filter offers. */
export function kindOf(action: string): AuditKind | null {
  const prefix = action.split(".")[0] ?? "";
  return isAuditKind(prefix) ? prefix : null;
}

export function filtersActive(filters: AuditFilters): boolean {
  return Object.keys(filters).length > 0;
}

/** `{ a: 1, b: { c: 2 } }` as indented text for the details disclosure; empty meta prints nothing. */
export function metaText(meta: Record<string, unknown> | null | undefined): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  return JSON.stringify(meta, null, 2);
}
