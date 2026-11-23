/**
 * Pure rules for the maintenance screens (XE parity lane MAINT): whether the module is on, chip tones,
 * the due wording of a plan, milli-unit numbers of a reading, and the dictionary key of a server refusal.
 * The server stays the authority on every figure (due maths, flags, report) and every move.
 */
import type { MessageKey } from "@orrn/i18n";
import { isModuleOn, type StatusTone } from "@orrn/domain";

import { canAny, type Action } from "@/shared/lib/me";

export const WO_STATUSES = ["open", "in_progress", "waiting_spares", "done", "cancelled"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];
export const WO_KINDS = ["breakdown", "preventive", "condition"] as const;
export type WoKind = (typeof WO_KINDS)[number];
export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const ASSET_KINDS = ["press", "furnace", "oven", "compressor", "crane", "dg_set", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const LINK_KINDS = ["press", "furnace", "oven"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const CRITICALITIES = ["A", "B", "C"] as const;
export type Criticality = (typeof CRITICALITIES)[number];
export const ASSET_STATUSES = ["running", "standby", "under_repair", "retired"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const READING_FLAGS = ["ok", "low", "high"] as const;
export type ReadingFlag = (typeof READING_FLAGS)[number];
export const DUE_STATES = ["ok", "soon", "overdue"] as const;
export type DueState = (typeof DUE_STATES)[number];

const isOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (list as readonly string[]).includes(v);

export const isWoStatus = isOf(WO_STATUSES);
export const isWoKind = isOf(WO_KINDS);
export const isPriority = isOf(PRIORITIES);
export const isAssetKind = isOf(ASSET_KINDS);
export const isLinkKind = isOf(LINK_KINDS);
export const isCriticality = isOf(CRITICALITIES);
export const isAssetStatus = isOf(ASSET_STATUSES);
export const isReadingFlag = isOf(READING_FLAGS);
export const isDueState = isOf(DUE_STATES);

export const WO_STATUS_TONE: Record<WoStatus, StatusTone> = {
  open: "amber",
  in_progress: "blue",
  waiting_spares: "amber",
  done: "green",
  cancelled: "neutral",
};

export const PRIORITY_TONE: Record<Priority, StatusTone> = { high: "red", medium: "amber", low: "neutral" };
export const DUE_TONE: Record<DueState, StatusTone> = { ok: "green", soon: "amber", overdue: "red" };
export const FLAG_TONE: Record<ReadingFlag, StatusTone> = { ok: "green", low: "red", high: "red" };
export const ASSET_STATUS_TONE: Record<AssetStatus, StatusTone> = { running: "green", standby: "neutral", under_repair: "amber", retired: "neutral" };

type MeLike = Parameters<typeof canAny>[0];

/** The module is on for this plant, by the server's rule (`isModuleOn`, B1). */
export function maintenanceOn(me: MeLike): boolean {
  return isModuleOn((me as { company?: { modules?: string[] | null } | null } | null | undefined)?.company?.modules ?? [], "maintenance");
}

/**
 * The plant's module list names maintenance (not just "empty list = all on"). A shared screen shows a
 * maintenance load error only then, so a plant that never set maintenance up sees nothing new.
 */
export function maintenanceNamed(me: MeLike): boolean {
  const modules = ((me as { company?: { modules?: string[] | null } | null } | null | undefined)?.company?.modules ?? []).map((m) => m.toLowerCase());
  return modules.includes("maintenance");
}

/** The person may use `actions` here AND the module is on: the gate for a query on a shared screen (Today, press). */
export function maintReady(me: MeLike, actions: readonly Action[]): boolean {
  return !!me && maintenanceOn(me) && canAny(me, actions as Action[]);
}

export type PlanDue = {
  state: string;
  basis: "days" | "hours";
  daysLeft: number | null;
  hoursLeft: number | null;
  hoursRun: number | null;
};

/**
 * The words of a plan's due figures, nearest first: the interval that comes first, then the other one
 * when the plan has both ("Due in 4 days", "Over by 12 run hours").
 */
export function dueLines(due: PlanDue): { key: MessageKey; vars?: Record<string, number> }[] {
  const days = (): { key: MessageKey; vars?: Record<string, number> } | null => {
    if (due.daysLeft == null) return null;
    // Plant days (server): 0 is the due day itself, negative is overdue.
    if (due.daysLeft < 0) return { key: "maint.due.overdueDays", vars: { n: -due.daysLeft } };
    if (due.daysLeft === 0) return { key: "maint.due.today" };
    return { key: "maint.due.inDays", vars: { n: due.daysLeft } };
  };
  const hours = (): { key: MessageKey; vars?: Record<string, number> } | null => {
    if (due.hoursLeft == null) return null;
    // The server rounds run hours left UP while time is left, so 0 means the hours are just reached.
    if (due.hoursLeft < 0) return { key: "maint.due.overHours", vars: { n: -due.hoursLeft } };
    if (due.hoursLeft === 0) return { key: "maint.due.hoursNow" };
    return { key: "maint.due.inHours", vars: { n: due.hoursLeft } };
  };
  const first = due.basis === "days" ? days() : hours();
  const second = due.basis === "days" ? hours() : days();
  return [first, second].filter((x): x is { key: MessageKey; vars?: Record<string, number> } => x !== null);
}

/** A reading value in thousandths as typed text: 72000 -> "72", 2500 -> "2.5", -1250 -> "-1.25". */
export function milliText(milli: number | null | undefined): string {
  if (milli == null) return "";
  const neg = milli < 0;
  const abs = Math.abs(Math.round(milli));
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Typed text to thousandths: "72" -> 72000, "2.5" -> 2500, "-1.25" -> -1250; null when it is not a number (at most 3 decimals). */
export function parseMilli(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d{1,9}(\.\d{1,3})?$/.test(t)) return null;
  const neg = t.startsWith("-");
  const [whole, frac = ""] = t.replace("-", "").split(".");
  const value = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  return neg ? -value : value;
}

/** Minutes as "h:mm" ("90" -> "1:30"), for labour and downtime figures. */
export function hoursMinutes(min: number | null | undefined): string {
  if (min == null) return "";
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Server refusal sentence -> dictionary key. Unknown sentences fall back to a plain "did not work". */
const REFUSALS: readonly [RegExp, MessageKey][] = [
  [/^Not found$/, "maint.errors.notFound"],
  [/changed since you opened it/, "maint.errors.changed"],
  [/^This work order is closed$/, "maint.errors.final"],
  [/^Others are raising work orders at the same moment/, "maint.errors.numberBusy"],
  [/^A work order cannot move to that status/, "maint.errors.badMove"],
  [/^Write what was done/, "maint.errors.needsWorkDone"],
  [/^Say why the work order is cancelled/, "maint.errors.needsReason"],
  [/^The finish time is before the start time/, "maint.errors.finishBeforeStart"],
  [/^Only a downtime entry with the breakdown reason/, "maint.errors.notBreakdown"],
  [/^No asset points at this press yet/, "maint.errors.noAsset"],
  [/^Only a store issue for maintenance/, "maint.errors.spareNotMaintenance"],
  [/^That store issue was cancelled/, "maint.errors.spareCancelled"],
  [/^That store issue is already on a work order/, "maint.errors.spareTaken"],
  [/^That store issue is not on this work order/, "maint.errors.spareNotLinked"],
  [/^This asset has no run hours/, "maint.errors.noRunHours"],
  [/^A plan needs days, run hours or both/, "maint.errors.needsInterval"],
  [/^Plans on this asset run on run hours/, "maint.errors.hoursPlans"],
  [/^Another asset already has that code/, "maint.errors.codeTaken"],
  [/^Another asset already points at that/, "maint.errors.linkTaken"],
  [/^That press, furnace or oven is not in this plant/, "maint.errors.linkMissing"],
  [/^The person is not a member of this plant/, "maint.errors.notMember"],
  [/^Give a low limit, a high limit or both/, "maint.errors.limitInvalid"],
  [/^This asset already reads something by that name/, "maint.errors.kindTaken"],
  [/^That reading is switched off/, "maint.errors.kindOff"],
  [/^This reading's unit or limits changed just now/, "maint.errors.kindChanged"],
  [/^That reading is inside its limits/, "maint.errors.inLimit"],
  [/^This asset is retired/, "maint.errors.retired"],
  [/^That module is not on for this plant/, "maint.errors.moduleOff"],
  [/^A start or finish time cannot be in the future/, "maint.errors.timeFuture"],
  [/^A done work order keeps its start and finish times/, "maint.errors.doneKeepsTimes"],
  [/^A press asset points at a press/, "maint.errors.linkKindMismatch"],
  [/^This reading already has readings in its unit/, "maint.errors.unitLocked"],
];

/** The words for a refused maintenance call: never the server's raw text. */
export function maintErrorKey(error: unknown): MessageKey {
  const message = error instanceof Error ? error.message : typeof (error as { message?: unknown })?.message === "string" ? String((error as { message: string }).message) : "";
  for (const [re, key] of REFUSALS) if (re.test(message)) return key;
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "FORBIDDEN") return "maint.errors.forbidden";
  if (code === "NOT_FOUND") return "maint.errors.notFound";
  if (code === "CONFLICT") return "maint.errors.changed";
  return "maint.errors.unknown";
}
