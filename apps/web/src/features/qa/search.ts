/**
 * Search params of `/qa` (XE parity lane QA). Plain functions, no imports: `validateSearch` stays in the
 * route entry chunk (AGENTS.md "Route files and the `/` budget"), so the lists are written out here.
 * Each register is the Checks tab filtered by kind (`?tab=checks&kind=incoming`), so it has its own URL.
 */
export const QA_TABS = ["waiting", "holds", "checks", "instruments", "lists", "settings"] as const;
export type QaTab = (typeof QA_TABS)[number];

export const QA_KINDS = ["incoming", "first_piece", "in_process", "clearance", "dimension", "mechanical", "ultrasonic"] as const;
export type QaKind = (typeof QA_KINDS)[number];

export const QA_STAGE_LIST = ["incoming", "press", "ageing", "pack", "dispatch"] as const;
export type QaStageId = (typeof QA_STAGE_LIST)[number];

export const QA_LISTS = ["tempers", "plans", "stations", "substitutes"] as const;
export type QaList = (typeof QA_LISTS)[number];

export type QaSearch = {
  tab?: QaTab;
  /** Checks: the register (kind). */
  kind?: QaKind;
  /** Checks: clearances for one stage. Waiting: the stage shown. */
  stage?: QaStageId;
  /** Holds: the hold log instead of the open holds. */
  log?: true;
  /** Lists: which list. */
  list?: QaList;
  /** Checks: one press run's quality (its id). */
  run?: string;
};

const pick = <T extends string>(all: readonly T[], v: unknown): T | undefined => (typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : undefined);

export function parseQaSearch(raw: Record<string, unknown>): QaSearch {
  const out: QaSearch = {};
  const tab = pick(QA_TABS, raw.tab);
  if (tab && tab !== "waiting") out.tab = tab;
  const kind = pick(QA_KINDS, raw.kind);
  if (kind) out.kind = kind;
  const stage = pick(QA_STAGE_LIST, raw.stage);
  if (stage) out.stage = stage;
  if (raw.log === true || raw.log === "1" || raw.log === 1 || raw.log === "true") out.log = true;
  const list = pick(QA_LISTS, raw.list);
  if (list) out.list = list;
  if (typeof raw.run === "string" && raw.run && raw.run.length <= 64) out.run = raw.run;
  return out;
}
