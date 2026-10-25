/**
 * `/press/report` search params. Plain functions (no zod): `validateSearch` stays in the route
 * entry chunk (AGENTS.md "Web bundle").
 */
export type ReportSearch = { from?: string; to?: string; shift?: number; line?: string; plan?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportSearch(raw: Record<string, unknown>): ReportSearch {
  const out: ReportSearch = {};
  if (typeof raw.from === "string" && DAY.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === "string" && DAY.test(raw.to)) out.to = raw.to;
  const shift = Number(raw.shift);
  if (Number.isInteger(shift) && shift >= 1 && shift <= 4) out.shift = shift;
  if (typeof raw.line === "string" && raw.line && raw.line.length <= 64) out.line = raw.line;
  if (typeof raw.plan === "string" && raw.plan && raw.plan.length <= 64) out.plan = raw.plan;
  return out;
}

export type SummarySearch = { day?: string };
export function parseSummarySearch(raw: Record<string, unknown>): SummarySearch {
  return typeof raw.day === "string" && DAY.test(raw.day) ? { day: raw.day } : {};
}

export type QueueSearch = { section?: string; order?: string; copy?: string };
export function parseQueueSearch(raw: Record<string, unknown>): QueueSearch {
  const pick = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : undefined);
  const out: QueueSearch = {};
  const section = pick(raw.section);
  const order = pick(raw.order);
  const copy = pick(raw.copy);
  if (section) out.section = section;
  if (order) out.order = order;
  if (copy) out.copy = copy;
  return out;
}

/** `/press/alerts?show=all` (open alerts only when missing, so the list opens on what needs a look). */
export type AlertsSearch = { show?: "all" };
export function parseAlertsSearch(raw: Record<string, unknown>): AlertsSearch {
  return raw.show === "all" ? { show: "all" } : {};
}
