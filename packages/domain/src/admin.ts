/**
 * Plant administration rules (XE parity lane ADM, rows 20, 21, 57-62, 75-78, 80).
 *
 * - Number formats (#77): a plant may set the prefix, the financial-year part and the padding of a
 *   document number per doc type. Only the text changes: the counter (`doc_series`, one per company,
 *   doc type and period) stays the one source of the sequence, so a format change never reuses a
 *   number and the yearly restart is the counter's period, as before.
 * - Approver rules (#78): per approval kind, which roles may decide, plus an optional threshold over a
 *   figure the request already carries (dispatch overdraw above 2% needs the owner). No rule = the
 *   built-in approvers, so today's behaviour is the default.
 * - Small helpers for the masters: bank details, transit insurance, tooling stock, die cost per kg.
 */

// ---------------------------------------------------------------------------
// Number formats (#77)
// ---------------------------------------------------------------------------

/** How the financial year shows in a number: not at all, `2026-27`, or `26-27`. */
export const DOC_FORMAT_FY_STYLES = ["none", "long", "short"] as const;
export type DocFormatFyStyle = (typeof DOC_FORMAT_FY_STYLES)[number];

export type DocFormat = { prefix: string; fy: DocFormatFyStyle; pad: number };
/** `company.settings.docFormats`: doc type -> format. A doc type that is missing prints as today. */
export type DocFormats = Partial<Record<string, DocFormat>>;

/**
 * Doc types whose text a plant may set. Bundle and cast numbers are read back by shape (QR codes,
 * `resolve.byCode`) and keep their fixed form; party bundle numbers follow the customer's policy.
 * Lanes that add a doc type append it here (append-only).
 */
export const FORMATTABLE_DOC_TYPES = [
  "so",
  "press_plan",
  "press_run",
  "lot",
  "dc_note",
  "grn",
  "mrs",
  "count",
  "ageing",
  "die_maker_job",
  "pl",
  "cert",
] as const;
export type FormattableDocType = (typeof FORMATTABLE_DOC_TYPES)[number];

/**
 * Doc types whose stored number is unique across years (the table's unique key has no period), so
 * the year must be part of the text or a number would repeat on 1 April. Append-only.
 */
export const DOC_TYPES_NEEDING_FY: readonly string[] = ["ageing", "pl", "cert"];

/** Today's fixed text per doc type, as a format (`SO-12`, `PL/2026-27/12`, `TC/2026-27/12`). */
export const DEFAULT_DOC_FORMATS: Readonly<Record<FormattableDocType, DocFormat>> = {
  so: { prefix: "SO-", fy: "none", pad: 0 },
  press_plan: { prefix: "PP-", fy: "none", pad: 0 },
  press_run: { prefix: "PR-", fy: "none", pad: 0 },
  lot: { prefix: "LOT-", fy: "none", pad: 0 },
  dc_note: { prefix: "DCN-", fy: "none", pad: 0 },
  grn: { prefix: "GRN-", fy: "none", pad: 0 },
  mrs: { prefix: "MRS-", fy: "none", pad: 0 },
  count: { prefix: "CNT-", fy: "none", pad: 0 },
  ageing: { prefix: "AG-", fy: "none", pad: 0 },
  die_maker_job: { prefix: "DM-", fy: "none", pad: 0 },
  pl: { prefix: "PL/", fy: "long", pad: 0 },
  cert: { prefix: "TC/", fy: "long", pad: 0 },
};

export const MAX_DOC_PREFIX = 12;
export const MAX_DOC_PAD = 8;
/** Letters and the separators / - _ . only: no digits, so the text always reads back to one number. */
const PREFIX_CHARS = /^[A-Za-z/._-]*$/;

export function isFormattableDocType(v: unknown): v is FormattableDocType {
  return typeof v === "string" && (FORMATTABLE_DOC_TYPES as readonly string[]).includes(v);
}

export type DocFormatError = "prefix_chars" | "prefix_length" | "pad_range" | "fy_style" | "fy_required" | "unknown_type";

/**
 * Check one format. The prefix has no digits, so the prefix is the leading run of non-digits, the
 * year part (when shown) has a fixed shape and ends with `/`, and the sequence is the trailing
 * digits: one text can only ever mean one (prefix, year, sequence). Two formats of the same year
 * can therefore never print the same text for two different sequence numbers.
 */
export function checkDocFormat(docType: string, format: DocFormat): DocFormatError | null {
  if (!isFormattableDocType(docType)) return "unknown_type";
  if (typeof format.prefix !== "string" || format.prefix.length > MAX_DOC_PREFIX) return "prefix_length";
  if (!PREFIX_CHARS.test(format.prefix)) return "prefix_chars";
  if (!Number.isInteger(format.pad) || format.pad < 0 || format.pad > MAX_DOC_PAD) return "pad_range";
  if (!(DOC_FORMAT_FY_STYLES as readonly string[]).includes(format.fy)) return "fy_style";
  if (format.fy === "none" && DOC_TYPES_NEEDING_FY.includes(docType)) return "fy_required";
  return null;
}

/** The plant's formats as stored, keeping only valid entries (a bad one prints as today). */
export function readDocFormats(raw: unknown): DocFormats {
  if (!raw || typeof raw !== "object") return {};
  const out: DocFormats = {};
  for (const [type, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const format: DocFormat = { prefix: String(v.prefix ?? ""), fy: v.fy as DocFormatFyStyle, pad: Number(v.pad ?? 0) };
    if (checkDocFormat(type, format) === null) out[type] = format;
  }
  return out;
}

/** `2026-27` -> `26-27`. A period that is not a financial year is printed as it is. */
function shortFy(period: string): string {
  return /^\d{4}-\d{2}$/.test(period) ? period.slice(2) : period;
}

/** The text of sequence `seq` in `period` under `format`: prefix, year part and `/`, padded number. */
export function formatDocNumberWith(format: DocFormat, period: string, seq: number): string {
  const year = format.fy === "none" ? "" : `${format.fy === "short" ? shortFy(period) : period}/`;
  return `${format.prefix}${year}${String(seq).padStart(format.pad, "0")}`;
}

/** The format a doc type prints with on this plant: its own when set, else today's. */
export function effectiveDocFormat(docType: FormattableDocType, formats: DocFormats | null | undefined): DocFormat {
  return formats?.[docType] ?? DEFAULT_DOC_FORMATS[docType];
}

// ---------------------------------------------------------------------------
// Approver rules (#78)
// ---------------------------------------------------------------------------

/** What a threshold is measured in: basis points (2% = 200) or grams per 12 ft. */
export type ApprovalMeasureUnit = "bp" | "g12ft";

/**
 * Figures a threshold may read, per approval kind, from the request's own meta (what the requester
 * asked for, never re-read). A kind without an entry takes roles only. Append-only.
 */
export const APPROVAL_MEASURES: Readonly<Partial<Record<string, { unit: ApprovalMeasureUnit; measure: (meta: Record<string, unknown> | null | undefined) => number | null }>>> = {
  /** The worst line's kg past what was ordered, in basis points of ordered (rounded up). */
  dispatch_overdraw: {
    unit: "bp",
    measure: (meta) => {
      const lines = Array.isArray(meta?.lines) ? (meta!.lines as Record<string, unknown>[]) : [];
      let worst: number | null = null;
      for (const l of lines) {
        const ordered = Number(l.orderedG);
        const total = Number(l.totalG);
        if (!Number.isFinite(ordered) || !Number.isFinite(total) || ordered <= 0) continue;
        const over = total - ordered;
        const bp = over <= 0 ? 0 : Math.ceil((over * 10_000) / ordered);
        worst = worst === null ? bp : Math.max(worst, bp);
      }
      return worst;
    },
  },
  /** How far the bundle's kg/12ft is from its order line, in grams per 12 ft. */
  dispatch_off_band: {
    unit: "g12ft",
    measure: (meta) => {
      const diff = Number(meta?.diffMilli);
      return Number.isFinite(diff) ? Math.abs(diff) : null;
    },
  },
};

export type ApprovalRule = {
  /** Roles that may decide. The owner always may. */
  roles: string[];
  /** Above this figure (strictly), only these roles may decide (the owner always may). */
  above?: { value: number; roles: string[] } | null;
};
/** `company.settings.approvalRules`: approval kind -> rule. A kind without a rule keeps its built-in approvers. */
export type ApprovalRules = Partial<Record<string, ApprovalRule>>;

const OWNER = "owner";
export const MAX_APPROVAL_THRESHOLD = 1_000_000;

function withOwner(roles: readonly string[]): string[] {
  const out = roles.includes(OWNER) ? [...roles] : [OWNER, ...roles];
  return [...new Set(out)];
}

export type ApprovalRuleError = "roles_empty" | "role_unknown" | "threshold_not_offered" | "threshold_range" | "above_roles_empty";

/** Check one rule against the plant's role list and the kind's measure. */
/** The roles a rule may name: one list for every kind, or a list per kind (review ADM B1). */
export type RuleRoles = readonly string[] | ((kind: string) => readonly string[]);

export function checkApprovalRule(kind: string, rule: ApprovalRule, allowed: RuleRoles): ApprovalRuleError | null {
  const knownRoles = typeof allowed === "function" ? allowed(kind) : allowed;
  if (!Array.isArray(rule.roles) || rule.roles.length === 0) return "roles_empty";
  if (rule.roles.some((r) => !knownRoles.includes(r))) return "role_unknown";
  if (rule.above) {
    if (!APPROVAL_MEASURES[kind]) return "threshold_not_offered";
    const { value, roles } = rule.above;
    if (!Number.isInteger(value) || value < 0 || value > MAX_APPROVAL_THRESHOLD) return "threshold_range";
    if (!Array.isArray(roles) || roles.length === 0) return "above_roles_empty";
    if (roles.some((r) => !knownRoles.includes(r))) return "role_unknown";
  }
  return null;
}

/** The plant's rules as stored, keeping only valid ones; the owner is put back in every list. */
export function readApprovalRules(raw: unknown, knownRoles: RuleRoles): ApprovalRules {
  if (!raw || typeof raw !== "object") return {};
  const out: ApprovalRules = {};
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as ApprovalRule;
    if (checkApprovalRule(kind, v, knownRoles) !== null) continue;
    out[kind] = {
      roles: withOwner(v.roles),
      above: v.above ? { value: v.above.value, roles: withOwner(v.above.roles) } : null,
    };
  }
  return out;
}

/**
 * Who may decide one request: the rule's roles (or the built-in ones without a rule); when the rule
 * has a threshold and the request's figure is above it, the threshold's roles instead. The owner is
 * always in the answer, and the requester is refused elsewhere whatever this says.
 */
export function approverRolesFor(
  kind: string,
  builtIn: readonly string[],
  rules: ApprovalRules | null | undefined,
  meta: Record<string, unknown> | null | undefined,
): readonly string[] {
  const rule = rules?.[kind];
  if (!rule) return builtIn;
  if (rule.above) {
    const measured = APPROVAL_MEASURES[kind]?.measure(meta) ?? null;
    if (measured !== null && measured > rule.above.value) return withOwner(rule.above.roles);
  }
  return withOwner(rule.roles);
}

/** Every role that could decide some request of this kind (for "does this person approve anything"). */
export function possibleApproverRoles(kind: string, builtIn: readonly string[], rules: ApprovalRules | null | undefined): readonly string[] {
  const rule = rules?.[kind];
  if (!rule) return builtIn;
  return [...new Set([...withOwner(rule.roles), ...(rule.above ? withOwner(rule.above.roles) : [])])];
}

// ---------------------------------------------------------------------------
// Bank details (#20) and transit insurance (#21)
// ---------------------------------------------------------------------------

/** Indian Financial System Code: four letters, a zero, six letters or digits. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function isIfsc(v: string): boolean {
  return IFSC_PATTERN.test(v.trim().toUpperCase());
}

/** Account number: 6 to 20 digits (Indian banks run 9 to 18). */
export function isBankAccountNo(v: string): boolean {
  return /^\d{6,20}$/.test(v.replace(/\s+/g, ""));
}

/** `company.settings.transitInsurance` (#21). Dates are plant calendar days `YYYY-MM-DD`. */
export type TransitInsurance = {
  policyNo: string;
  insurer: string;
  validFrom: string | null;
  validTo: string | null;
  /** Print the policy on the packing list. */
  printOnPl: boolean;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !YMD.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function readTransitInsurance(raw: unknown): TransitInsurance | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const policyNo = typeof v.policyNo === "string" ? v.policyNo.trim() : "";
  const insurer = typeof v.insurer === "string" ? v.insurer.trim() : "";
  if (!policyNo || !insurer) return null;
  return {
    policyNo,
    insurer,
    validFrom: isYmd(v.validFrom) ? v.validFrom : null,
    validTo: isYmd(v.validTo) ? v.validTo : null,
    printOnPl: v.printOnPl !== false,
  };
}

/**
 * What the packing list prints for transit insurance on calendar day `today`: the policy when it is
 * set, marked to print, and not past its validity (a lapsed policy is not printed as cover).
 */
export function insuranceForPl(ins: TransitInsurance | null, today: string): { policyNo: string; insurer: string; validTo: string | null } | null {
  if (!ins || !ins.printOnPl) return null;
  if (ins.validTo && today > ins.validTo) return null;
  if (ins.validFrom && today < ins.validFrom) return null;
  return { policyNo: ins.policyNo, insurer: ins.insurer, validTo: ins.validTo };
}

// ---------------------------------------------------------------------------
// Plant masters (#57, #75, #76)
// ---------------------------------------------------------------------------

/** Kinds of the simple per-plant lists in `plant_master`. */
export const PLANT_MASTER_KINDS = ["department", "designation", "packing_mode", "die_category"] as const;
export type PlantMasterKind = (typeof PLANT_MASTER_KINDS)[number];

/** The lists a new plant starts with (one tap to add, never forced). */
export const PLANT_MASTER_STARTERS: Readonly<Record<PlantMasterKind, readonly string[]>> = {
  department: ["Foundry", "Press", "Die room", "Packing", "Dispatch", "Office", "Store", "Maintenance"],
  designation: ["Supervisor", "Operator", "Helper", "Manager", "Clerk"],
  packing_mode: ["Paper wrap", "Poly wrap", "Wooden crate", "Carton", "Loose"],
  die_category: ["Solid", "Hollow", "Semi-hollow", "Porthole", "Multi-cavity"],
};

// ---------------------------------------------------------------------------
// Tooling (#58, #59, #62)
// ---------------------------------------------------------------------------

export const TOOLING_TYPES = ["bolster", "backer", "die_ring", "container", "liner", "other"] as const;
export type ToolingType = (typeof TOOLING_TYPES)[number];

export const TOOLING_STATUSES = ["awaiting_inspection", "in_store", "in_use", "at_maker", "failed", "retired"] as const;
export type ToolingStatus = (typeof TOOLING_STATUSES)[number];

/** Statuses that count as "we have one" for the minimum count. */
export const TOOLING_COUNTED: readonly ToolingStatus[] = ["in_store", "in_use"];

export const INSPECTION_RESULTS = ["pass", "fail"] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

/** `company.settings.toolingMinStock`: tooling type -> the fewest the plant wants to hold (0 = no alert). */
export type ToolingMinStock = Partial<Record<ToolingType, number>>;
export const MAX_TOOLING_MIN = 999;

export function readToolingMinStock(raw: unknown): ToolingMinStock {
  if (!raw || typeof raw !== "object") return {};
  const out: ToolingMinStock = {};
  for (const t of TOOLING_TYPES) {
    const n = (raw as Record<string, unknown>)[t];
    if (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_TOOLING_MIN) out[t] = n;
  }
  return out;
}

/** Tooling types below their minimum, with what is held and what is wanted, in type order. */
export function toolingShortfalls(min: ToolingMinStock, held: Partial<Record<ToolingType, number>>): { type: ToolingType; held: number; min: number }[] {
  const out: { type: ToolingType; held: number; min: number }[] = [];
  for (const t of TOOLING_TYPES) {
    const want = min[t];
    if (!want) continue;
    const have = held[t] ?? 0;
    if (have < want) out.push({ type: t, held: have, min: want });
  }
  return out;
}

/** The status a tooling item takes after a receive inspection. */
export function toolingStatusAfterInspection(result: InspectionResult): ToolingStatus {
  return result === "pass" ? "in_store" : "failed";
}

// ---------------------------------------------------------------------------
// Die cost (#60)
// ---------------------------------------------------------------------------

/**
 * Cost per kg extruded, in paise per kg, rounded half up: purchase cost over the good kg the copy
 * has made. Null without a cost or before the first kg.
 */
export function dieCostPerKgPaise(costPaise: number | null | undefined, producedG: number): number | null {
  if (costPaise == null || !(costPaise > 0) || !(producedG > 0)) return null;
  return Math.floor((costPaise * 1000 * 2 + producedG) / (producedG * 2));
}

// ---------------------------------------------------------------------------
// Document register (#80)
// ---------------------------------------------------------------------------

export const PLANT_DOCUMENT_KINDS = ["procedure", "customer_spec", "drawing", "certificate", "other"] as const;
export type PlantDocumentKind = (typeof PLANT_DOCUMENT_KINDS)[number];

/** A document whose review date is on or before `today` (plant calendar day) is due. */
export function documentReviewDue(reviewOn: string | null | undefined, today: string): boolean {
  return Boolean(reviewOn && reviewOn <= today);
}

/** The plant bank account a printed paper shows (XE ADM `getPlantBankForPrint`, wired by PROD-GATE). */
export type BankForPrint = { bankName: string; branch: string | null; accountName: string; accountNo: string; ifsc: string };

/**
 * The bank lines a printed paper carries, in print order: bank and branch, account name, account number,
 * IFSC. Papers are English (the proforma and the tax invoice), so the two labels are fixed text.
 */
export function bankPrintParts(b: BankForPrint): string[] {
  const head = [b.bankName.trim(), b.branch?.trim() ?? ""].filter(Boolean).join(", ");
  return [head, b.accountName.trim(), `A/c ${b.accountNo.trim()}`, `IFSC ${b.ifsc.trim()}`].filter((x) => x && x !== "A/c " && x !== "IFSC ");
}
