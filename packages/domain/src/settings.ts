/**
 * Company settings and modules for the floor waves (FP-PF-05/06/07/09/13; C41, C42; ledger D6/D8).
 * Everything lives in `company.settings` (JSON) and `company.modules`; there are no settings
 * tables. `readFloorSettings` is the one tolerant reader: malformed values fall back to defaults.
 * Writes go through `company.updateSettings` (`settings.update`: owner and admin, C41).
 */
import { DRIFT_AMBER_MAX_BP, DRIFT_GREEN_MAX_BP, type DriftBands, type RecoveryBands } from "./drift";
import type { ProfileKind } from "./packDispatch";
import { PRESS_BALANCE_WARN_BP } from "./pressRun";
import { validateShifts, type Shift } from "./shifts";

// ---------------------------------------------------------------------------
// Modules (FP-PF-07)
// ---------------------------------------------------------------------------

/** Allowed `company.modules` keys (lower case). Empty list = every module on. */
export const COMPANY_MODULES = [
  "customers",
  "dies",
  "bundles",
  "dispatches",
  "orders",
  "foundry",
  "press",
  "ageing",
  "store",
  "purchase",
] as const;
export type CompanyModule = (typeof COMPANY_MODULES)[number];

export function isCompanyModule(value: unknown): value is CompanyModule {
  return typeof value === "string" && (COMPANY_MODULES as readonly string[]).includes(value);
}

/** Server rule for `assertModule`: an empty or missing list means all on. */
export function isModuleOn(modules: readonly string[] | null | undefined, module: CompanyModule): boolean {
  if (!modules || modules.length === 0) return true;
  return modules.includes(module);
}

/** Lower-case, de-duplicate and check a modules list; unknown keys are returned, never stored. */
export function normalizeModules(input: readonly string[]): { modules: CompanyModule[]; unknown: string[] } {
  const modules: CompanyModule[] = [];
  const unknown: string[] = [];
  for (const raw of input) {
    const key = raw.trim().toLowerCase();
    if (isCompanyModule(key)) {
      if (!modules.includes(key)) modules.push(key);
    } else unknown.push(raw);
  }
  return { modules, unknown };
}

// ---------------------------------------------------------------------------
// Standards (FP-PF-09)
// ---------------------------------------------------------------------------

/** BIS designation and CM/L licence for one profile kind. Empty string = unset. Max 40 each. */
export type StandardPair = { standard: string; cml: string };
export type Standards = { solid?: StandardPair; hollow?: StandardPair; semi?: StandardPair };
export const MAX_STANDARD_TEXT = 40;

function isBlank(p: StandardPair | undefined | null): boolean {
  return !p || (p.standard.trim() === "" && p.cml.trim() === "");
}

/**
 * The pair pack snapshots onto a bundle (reprint never re-reads settings). Semi falls back to
 * solid when blank; a null profile kind uses solid. Null when nothing is set for that kind.
 */
export function resolveStandard(standards: Standards | null | undefined, profileKind: ProfileKind | null | undefined): StandardPair | null {
  const s = standards ?? {};
  const kind = profileKind ?? "solid";
  let pair = s[kind];
  if (kind === "semi" && isBlank(pair)) pair = s.solid;
  if (isBlank(pair)) return null;
  return { standard: pair!.standard.trim(), cml: pair!.cml.trim() };
}

// ---------------------------------------------------------------------------
// Floor settings
// ---------------------------------------------------------------------------

export const SETTINGS_LOCALES = ["en", "hi", "gu"] as const;
export type SettingsLocale = (typeof SETTINGS_LOCALES)[number];

/** Company letterhead (PL v2 header, certificate): the company's legal name, GSTIN, address, phone. */
export type Letterhead = { legalName: string | null; gstin: string | null; address: string | null; phone: string | null };

export type FloorSettings = {
  shifts: Shift[];
  /** Off hides die bands and the band-start weight basis in order entry (C21). */
  dieBands: boolean;
  /** Rates on sales order lines; also needs `order.price` (C23). */
  priceOnSalesOrder: boolean;
  /** Confirm needs a copy or a tier on every line (C22). */
  dieRequiredOnSalesOrder: boolean;
  portalEnabled: boolean;
  standards: Standards;
  locale: SettingsLocale;
  drift: DriftBands;
  /** Recovery colour bands for the press report; null = no colour (ledger D8: a tenant setting). */
  recoveryBands: RecoveryBands | null;
  defaultAlloy: string;
  defaultTemper: string;
  /**
   * `requireCastOnBundle`: true / false when the plant set it; null = automatic (on once the
   * company has a locked melt, FP-FD-16).
   */
  requireCastOnBundle: boolean | null;
  press: { balanceWarnBp: number };
  ageing: { manualLoad: boolean; split: boolean; requireForPack: boolean };
  letterhead: Letterhead;
  /** Wave 2 (FP-DR-17): new copies and copies back from the maker start `on_trial` (default on). */
  dieRoom: { newCopyOnTrial: boolean };
  /** Continue the paper cast book (FP-FD-02, Q-FD-2): the month's first seq. null = start at 1. */
  castSeriesStart: CastSeriesStart | null;
  /** Wave 2 (FP-OP-01, Q8): days from the order date to the expected date a new order starts with. */
  orderLeadDays: number;
  /** Wave 2 (FP-PK-13): the packing list's optional kg-per-piece column (off by default). */
  packingList: { kgPerPiece: boolean };
};

/** Lead time a new sales order's expected date starts from (OWNER_QUESTIONS Q8 A: 15 days). */
export const ORDER_LEAD_DAYS_DEFAULT = 15;
export const ORDER_LEAD_DAYS_MAX = 120;

/** `company.settings.castSeriesStart`: the month `YYYY-MM` whose first cast takes `start`. */
export type CastSeriesStart = { period: string; start: number };

export const FLOOR_SETTINGS_DEFAULTS: FloorSettings = {
  shifts: [],
  dieBands: true,
  priceOnSalesOrder: false,
  dieRequiredOnSalesOrder: true,
  portalEnabled: false,
  standards: {},
  locale: "en",
  drift: { greenMaxBp: DRIFT_GREEN_MAX_BP, amberMaxBp: DRIFT_AMBER_MAX_BP },
  recoveryBands: null,
  defaultAlloy: "6063",
  defaultTemper: "T6",
  requireCastOnBundle: null,
  press: { balanceWarnBp: PRESS_BALANCE_WARN_BP },
  ageing: { manualLoad: true, split: false, requireForPack: false },
  letterhead: { legalName: null, gstin: null, address: null, phone: null },
  dieRoom: { newCopyOnTrial: true },
  castSeriesStart: null,
  orderLeadDays: ORDER_LEAD_DAYS_DEFAULT,
  packingList: { kgPerPiece: false },
};

/** A valid `castSeriesStart` or null (month `YYYY-MM`, start 1 … 99,999). */
export function readCastSeriesStart(v: unknown): CastSeriesStart | null {
  const o = obj(v);
  if (typeof o.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(o.period)) return null;
  if (typeof o.start !== "number" || !Number.isInteger(o.start) || o.start < 1 || o.start > 99_999) return null;
  return { period: o.period, start: o.start };
}

/** First sequence of the cast series for `period` (`YYYY-MM`): the book's start for that month, else 1. */
export function castSeriesFirstSeq(start: CastSeriesStart | null | undefined, period: string): number {
  return start && start.period === period ? start.start : 1;
}

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const bp = (v: unknown, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : d);
const str = (v: unknown, d: string, max: number) => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const nstr = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function readPair(v: unknown): StandardPair | undefined {
  const o = obj(v);
  if (typeof o.standard !== "string" && typeof o.cml !== "string") return undefined;
  return { standard: typeof o.standard === "string" ? o.standard : "", cml: typeof o.cml === "string" ? o.cml : "" };
}

function readShifts(v: unknown): Shift[] {
  if (!Array.isArray(v)) return [];
  const shifts = v.filter(
    (s): s is Shift =>
      Boolean(s) &&
      typeof s === "object" &&
      typeof (s as Shift).id === "string" &&
      typeof (s as Shift).name === "string" &&
      typeof (s as Shift).seq === "number" &&
      typeof (s as Shift).startMin === "number" &&
      typeof (s as Shift).endMin === "number",
  );
  // A stored list that fails the rules is ignored (calendar midnight) rather than half-applied.
  return shifts.length === v.length && validateShifts(shifts).length === 0 ? shifts.map((s) => ({ ...s })) : [];
}

/** Read `company.settings` for the floor modules; anything malformed takes its default. */
export function readFloorSettings(raw: Record<string, unknown> | null | undefined): FloorSettings {
  const s = raw ?? {};
  const d = FLOOR_SETTINGS_DEFAULTS;
  const green = bp(s.driftGreenMaxBp, d.drift.greenMaxBp);
  const amber = bp(s.driftAmberMaxBp, d.drift.amberMaxBp);
  const rb = obj(s.recoveryBands);
  const recoveryBands =
    typeof rb.greenMinBp === "number" && typeof rb.amberMinBp === "number" && rb.amberMinBp <= rb.greenMinBp
      ? { greenMinBp: bp(rb.greenMinBp, 0), amberMinBp: bp(rb.amberMinBp, 0) }
      : null;
  const st = obj(s.standards);
  const standards: Standards = {};
  for (const k of ["solid", "hollow", "semi"] as const) {
    const p = readPair(st[k]);
    if (p) standards[k] = p;
  }
  const press = obj(s.press);
  const ageing = obj(s.ageing);
  const lh = obj(s.letterhead);
  return {
    shifts: readShifts(s.shifts),
    dieBands: bool(s.dieBands, d.dieBands),
    priceOnSalesOrder: bool(s.priceOnSalesOrder, d.priceOnSalesOrder),
    dieRequiredOnSalesOrder: bool(s.dieRequiredOnSalesOrder, d.dieRequiredOnSalesOrder),
    portalEnabled: bool(s.portalEnabled, d.portalEnabled),
    standards,
    locale: (SETTINGS_LOCALES as readonly unknown[]).includes(s.locale) ? (s.locale as SettingsLocale) : d.locale,
    // Amber below green is malformed: keep both defaults.
    drift: amber >= green ? { greenMaxBp: green, amberMaxBp: amber } : { ...d.drift },
    recoveryBands,
    defaultAlloy: str(s.defaultAlloy, d.defaultAlloy, 16),
    defaultTemper: str(s.defaultTemper, d.defaultTemper, 8),
    requireCastOnBundle: typeof s.requireCastOnBundle === "boolean" ? s.requireCastOnBundle : null,
    press: { balanceWarnBp: bp(press.balanceWarnBp, d.press.balanceWarnBp) },
    ageing: {
      manualLoad: bool(ageing.manualLoad, d.ageing.manualLoad),
      split: bool(ageing.split, d.ageing.split),
      requireForPack: bool(ageing.requireForPack, d.ageing.requireForPack),
    },
    letterhead: { legalName: nstr(lh.legalName), gstin: nstr(lh.gstin), address: nstr(lh.address), phone: nstr(lh.phone) },
    dieRoom: { newCopyOnTrial: bool(obj(s.dieRoom).newCopyOnTrial, d.dieRoom.newCopyOnTrial) },
    castSeriesStart: readCastSeriesStart(s.castSeriesStart),
    orderLeadDays:
      typeof s.orderLeadDays === "number" && Number.isInteger(s.orderLeadDays) && s.orderLeadDays >= 0 && s.orderLeadDays <= ORDER_LEAD_DAYS_MAX
        ? s.orderLeadDays
        : d.orderLeadDays,
    packingList: { kgPerPiece: bool(obj(s.packingList).kgPerPiece, d.packingList.kgPerPiece) },
  };
}

/** `requireCastOnBundle` in effect: the plant's choice, else on once a melt has been locked. */
export function castRequiredOnBundle(settings: Pick<FloorSettings, "requireCastOnBundle">, hasLockedMelt: boolean): boolean {
  return settings.requireCastOnBundle ?? hasLockedMelt;
}
