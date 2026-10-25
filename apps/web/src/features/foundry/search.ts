/** URL search of the foundry routes. No imports on purpose (route budget: the route tree stays small). */
export type InboxTab = "waiting" | "arriving" | "handled";
export const INBOX_TABS: readonly InboxTab[] = ["waiting", "arriving", "handled"];

export function parseInboxSearch(raw: Record<string, unknown>): { tab?: Exclude<InboxTab, "waiting"> } {
  return raw.tab === "arriving" || raw.tab === "handled" ? { tab: raw.tab } : {};
}

export type CastTabSearch = { tab?: "trace"; bundle?: string };

/** `/casts/$id?tab=trace&bundle=26J1842`. */
export function parseCastSearch(raw: Record<string, unknown>): CastTabSearch {
  const out: CastTabSearch = {};
  if (raw.tab === "trace") out.tab = "trace";
  if (typeof raw.bundle === "string" && /^[A-Za-z0-9-]{1,20}$/.test(raw.bundle)) out.bundle = raw.bundle;
  return out;
}

export const MELT_STEP_IDS = ["times", "charge", "chemicals", "output", "spectro"] as const;
export type MeltStepId = (typeof MELT_STEP_IDS)[number];
export type MeltSearch = { step?: Exclude<MeltStepId, "times"> };

/** `/casts/$id/melt/$meltId?step=charge` (the first step stays out of the URL). */
export function parseMeltSearch(raw: Record<string, unknown>): MeltSearch {
  return typeof raw.step === "string" && (MELT_STEP_IDS as readonly string[]).includes(raw.step) && raw.step !== "times" ? { step: raw.step as MeltSearch["step"] } : {};
}

export type YieldGroup = "day" | "alloy" | "furnace";
export type YieldSearch = { from?: string; to?: string; group?: Exclude<YieldGroup, "day"> };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `/reports/foundry-yield?from=&to=&group=alloy|furnace` (by day when missing). */
export function parseYieldSearch(raw: Record<string, unknown>): YieldSearch {
  const out: YieldSearch = {};
  if (typeof raw.from === "string" && DAY.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === "string" && DAY.test(raw.to)) out.to = raw.to;
  if (raw.group === "alloy" || raw.group === "furnace") out.group = raw.group;
  return out;
}
