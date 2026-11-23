/**
 * Search params of the six XE register pages under `/reports` (rejections, recuts, wip, plan-actual,
 * unpacked, materials). Plain functions (no zod): `validateSearch` stays in the route entry chunk
 * (AGENTS.md "Web bundle"), so this module imports nothing heavy.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pickId = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : undefined);

export type RegRangeSearch = { from?: string; to?: string };

export function parseRegRange(raw: Record<string, unknown>): RegRangeSearch {
  const out: RegRangeSearch = {};
  if (typeof raw.from === "string" && DAY.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === "string" && DAY.test(raw.to)) out.to = raw.to;
  return out;
}

export type RejectionsSearch = RegRangeSearch & { source?: "press" | "pack"; section?: string; line?: string; shift?: string; reason?: string };

export function parseRejectionsSearch(raw: Record<string, unknown>): RejectionsSearch {
  const out: RejectionsSearch = parseRegRange(raw);
  if (raw.source === "press" || raw.source === "pack") out.source = raw.source;
  const section = pickId(raw.section);
  const line = pickId(raw.line);
  const shift = pickId(raw.shift);
  if (section) out.section = section;
  if (line) out.line = line;
  if (shift) out.shift = shift;
  if (typeof raw.reason === "string" && raw.reason && raw.reason.length <= 200) out.reason = raw.reason;
  return out;
}

export type RecutsSearch = RegRangeSearch & { section?: string };

export function parseRecutsSearch(raw: Record<string, unknown>): RecutsSearch {
  const out: RecutsSearch = parseRegRange(raw);
  const section = pickId(raw.section);
  if (section) out.section = section;
  return out;
}

export type WipSearch = { party?: string };

export function parseWipSearch(raw: Record<string, unknown>): WipSearch {
  const party = pickId(raw.party);
  return party ? { party } : {};
}

export const PLAN_ACTUAL_GROUP_KEYS = ["press", "die", "alloy", "shift"] as const;
export type PlanActualGroupSearch = (typeof PLAN_ACTUAL_GROUP_KEYS)[number];
export type PlanActualSearch = RegRangeSearch & { group?: PlanActualGroupSearch };

export function parsePlanActualSearch(raw: Record<string, unknown>): PlanActualSearch {
  const out: PlanActualSearch = parseRegRange(raw);
  if (raw.group === "die" || raw.group === "alloy" || raw.group === "shift") out.group = raw.group;
  return out;
}
