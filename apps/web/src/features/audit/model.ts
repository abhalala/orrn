/**
 * Pure model for the audit viewer (FP-PF-16): the filter shape in the URL, the kinds a person can
 * pick, and the conversion from a chosen date to the instant the server filters on. No React.
 */

/**
 * What each Kind in the filter covers: action prefixes (ending in ".") and exact action codes.
 * Every prefix the server writes belongs to exactly one Kind, so no entry is unreachable from the
 * filter (`die.` alone missed `die_instance.`, `nitriding.` and the rest). An action not listed
 * here still shows in "Everything".
 */
export const AUDIT_KIND_ACTIONS = {
  company: ["company.", "settings."],
  member: ["member.", "auth.", "invite."],
  device: ["device."],
  dispatch: ["dispatch.", "packingList."],
  bundle: ["bundle.", "move_found", "void_phantom"],
  die: ["die.", "die_instance.", "die_reading.", "die_tier.", "die_issue.", "die_band.", "die_owner.", "nitriding."],
  customer: ["customer."],
  stock: ["stock.", "location.", "return_stream."],
  order: ["order."],
  count: ["count."],
  press: ["press_run.", "ageing.", "downtime."],
  foundry: ["melt.", "cast.", "spectro."],
  purchase: ["purchase_lot.", "dc_note.", "vendor.", "scrap_grade.", "scrap_item.", "store.", "store_item."],
  approval: ["approval."],
  support_request: ["support_request."],
  backup: ["backup."],
  platform: ["platform.", "app_release.", "impersonation."],
} as const satisfies Record<string, readonly string[]>;

export type AuditKind = keyof typeof AUDIT_KIND_ACTIONS;
/** The order of the Kind list in the filter. */
export const AUDIT_KINDS = Object.keys(AUDIT_KIND_ACTIONS) as AuditKind[];

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
    ...(filters.kind ? { actions: [...AUDIT_KIND_ACTIONS[filters.kind]] } : {}),
    ...(filters.subject ? { subjectId: filters.subject } : {}),
    ...(filters.from ? { from: zonedDayStartMs(filters.from, timeZone) } : {}),
    ...(filters.to ? { to: zonedDayEndMs(filters.to, timeZone) } : {}),
  };
}

/** The Kind an action code belongs to; null when no Kind covers it. */
export function kindOf(action: string): AuditKind | null {
  for (const kind of AUDIT_KINDS) {
    for (const entry of AUDIT_KIND_ACTIONS[kind] as readonly string[]) {
      if (entry.endsWith(".") ? action.startsWith(entry) : action === entry) return kind;
    }
  }
  return null;
}

export function filtersActive(filters: AuditFilters): boolean {
  return Object.keys(filters).length > 0;
}

// ---------------------------------------------------------------------------
// Details: an entry's meta as readable key and value
// ---------------------------------------------------------------------------

export type MetaWords = { yes: string; no: string; none: string; change(from: string, to: string): string };
export type MetaEntry = { key: string; label: string; value: string };

/** `portalEnabled` and `session_ended` as "Portal enabled" and "Session ended". */
export function humanKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One value in words: booleans as Yes and No, nothing as "none", lists and objects on one line. */
export function metaValue(value: unknown, words: MetaWords): string {
  if (value === null || value === undefined || value === "") return words.none;
  if (typeof value === "boolean") return value ? words.yes : words.no;
  if (Array.isArray(value)) return value.map((v) => metaValue(v, words)).join(", ");
  if (isPlain(value)) {
    const parts = Object.entries(value).map(([k, v]) => `${k}: ${metaValue(v, words)}`);
    return parts.length ? parts.join(", ") : words.none;
  }
  return String(value);
}

/**
 * An entry's meta as rows a person can read. A settings update (`{ changed, previous }`) and a
 * rename or release flip (`{ from, to }`) show "old → new" per field; everything else is a plain
 * key and value. Empty meta gives no rows.
 */
export function metaEntries(meta: Record<string, unknown> | null | undefined, words: MetaWords): MetaEntry[] {
  if (!meta) return [];
  const out: MetaEntry[] = [];
  const consumed = new Set<string>();
  const change = (key: string, from: unknown, to: unknown, label = humanKey(key)) =>
    out.push({ key, label, value: words.change(metaValue(from, words), metaValue(to, words)) });

  if (isPlain(meta.changed)) {
    const previous = isPlain(meta.previous) ? meta.previous : {};
    for (const [key, to] of Object.entries(meta.changed)) change(key, previous[key], to);
    consumed.add("changed").add("previous");
  } else if ("from" in meta && "to" in meta) {
    if (isPlain(meta.from) && isPlain(meta.to)) {
      for (const key of new Set([...Object.keys(meta.from), ...Object.keys(meta.to)])) change(key, meta.from[key], meta.to[key]);
    } else {
      change("from", meta.from, meta.to, "Changed");
    }
    consumed.add("from").add("to");
  }
  for (const [key, value] of Object.entries(meta)) {
    if (!consumed.has(key)) out.push({ key, label: humanKey(key), value: metaValue(value, words) });
  }
  return out;
}

type ChangeRow = { at: string; action: string; actorName: string | null; byStaff?: boolean; meta: Record<string, unknown> };
export type SwitchChange = { at: string; actorName: string | null; byStaff: boolean; from: unknown; to: unknown };

/** The newest settings update that touched `key` (rows come newest first), or null. */
export function lastChangeOf(rows: readonly ChangeRow[], key: string): SwitchChange | null {
  for (const r of rows) {
    if (r.action !== "company.settings.update" || !isPlain(r.meta.changed) || !(key in r.meta.changed)) continue;
    const previous = isPlain(r.meta.previous) ? r.meta.previous : {};
    return { at: r.at, actorName: r.actorName, byStaff: r.byStaff ?? false, from: previous[key] ?? null, to: r.meta.changed[key] };
  }
  return null;
}
