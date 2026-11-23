import { checkDocFormat, formatDocNumberWith, isBankAccountNo, isIfsc, MAX_DOC_PAD, MAX_TOOLING_MIN, MAX_DOC_PREFIX, type DocFormat, type DocFormatFyStyle, type StatusTone } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { masterErrorKey, parsePercentBp, parseWholeNumber, percentText, type ErrorView } from "./masters-model";

/**
 * Plant lists, bank accounts, number formats, approval rules, transit insurance, the document
 * register and the tool room (XE ADM): pure helpers behind those screens. Nothing here reads the
 * network or the DOM, so every rule the forms check is testable without a render.
 */

// ---------------------------------------------------------------------------
// Number formats
// ---------------------------------------------------------------------------

export { MAX_DOC_PAD, MAX_DOC_PREFIX, MAX_TOOLING_MIN };
export const FY_STYLES: readonly DocFormatFyStyle[] = ["none", "long", "short"];

/** "2026-11-22" -> "2026-27": the plant's financial year runs April to March. */
export function fyPeriod(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd);
  if (!m) return "";
  const year = Number(m[1]);
  const start = Number(m[2]) >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/** The sequence at the end of a number's text ("PL/2026-27/0012" -> 12). The prefix never holds digits, so the last run is it. */
export function seqFromNext(text: string): number | null {
  const m = /(\d+)$/.exec(text);
  return m ? Number(m[1]) : null;
}

/** What a number would read under this format, for the live preview under the fields. */
export function previewNumber(format: DocFormat, period: string, seq: number): string {
  return formatDocNumberWith(format, period || "2026-27", seq);
}

export type FormatDraft = { prefix: string; fy: DocFormatFyStyle; pad: string };

export function draftFromFormat(format: DocFormat): FormatDraft {
  return { prefix: format.prefix, fy: format.fy, pad: String(format.pad) };
}

/** The draft as a format the server takes, or null while the padding is not a whole number from 0 to 8. */
export function formatFromDraft(draft: FormatDraft): DocFormat | null {
  const pad = parseWholeNumber(draft.pad, { min: 0, max: MAX_DOC_PAD });
  if (!pad.ok || pad.value === null) return null;
  return { prefix: draft.prefix.trim(), fy: draft.fy, pad: pad.value };
}

const FORMAT_PROBLEMS: Record<string, MessageKey> = {
  prefix_chars: "adm.masters.rules.formats.problem.prefixChars",
  prefix_length: "adm.masters.rules.formats.problem.prefixLength",
  pad_range: "adm.masters.rules.formats.problem.pad",
  fy_style: "adm.masters.rules.formats.problem.pad",
  fy_required: "adm.masters.rules.formats.problem.yearRequired",
  unknown_type: "adm.masters.rules.formats.problem.pad",
};

/** The plain reason a draft cannot be saved, or null. */
export function formatProblem(docType: string, draft: FormatDraft): MessageKey | null {
  const format = formatFromDraft(draft);
  if (!format) return "adm.masters.rules.formats.problem.pad";
  const err = checkDocFormat(docType, format);
  return err ? FORMAT_PROBLEMS[err]! : null;
}

export function sameFormat(a: DocFormat, b: DocFormat): boolean {
  return a.prefix === b.prefix && a.fy === b.fy && a.pad === b.pad;
}

// ---------------------------------------------------------------------------
// Approval rules
// ---------------------------------------------------------------------------

export type RuleDraft = {
  roles: string[];
  above: { value: number | null; roles: string[] } | null;
};

type StoredRule = { roles: string[]; above?: { value: number; roles: string[] } | null };

const OWNER = "owner";

/** The roles a person picks from: everyone but the owner, who is always an approver. */
export function pickableRoles(all: readonly string[]): string[] {
  return all.filter((r) => r !== OWNER);
}

export function draftFromRule(rule: StoredRule | null, builtIn: readonly string[]): RuleDraft {
  if (!rule) return { roles: pickableRoles(builtIn), above: null };
  return {
    roles: pickableRoles(rule.roles),
    above: rule.above ? { value: rule.above.value, roles: pickableRoles(rule.above.roles) } : null,
  };
}

export function toggleRole(roles: readonly string[], role: string): string[] {
  return roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role];
}

const withOwner = (roles: readonly string[]) => [OWNER, ...roles.filter((r) => r !== OWNER)];

/** Why the rule cannot be saved: a limit switched on with no figure. */
export function ruleProblem(draft: RuleDraft): "limit" | null {
  if (draft.above && draft.above.value === null) return "limit";
  return null;
}

/** The rule as the server takes it (the owner is always put first). */
export function ruleInput(draft: RuleDraft): { roles: string[]; above?: { value: number; roles: string[] } } {
  const base = { roles: withOwner(draft.roles) };
  if (draft.above && draft.above.value !== null) return { ...base, above: { value: draft.above.value, roles: withOwner(draft.above.roles) } };
  return base;
}

/** True when the draft says the same as the built-in approvers (nothing to store). */
export function matchesBuiltIn(draft: RuleDraft, builtIn: readonly string[]): boolean {
  if (draft.above) return false;
  const a = [...pickableRoles(builtIn)].sort().join(",");
  const b = [...draft.roles].sort().join(",");
  return a === b;
}

/** A percent limit: 200 -> "2", and back. Blank is "no figure"; above 100% or three decimals is refused. */
export function limitPercentText(bp: number | null): string {
  if (bp === null) return "";
  return percentText(bp)!.replace("%", "");
}
export function parseLimitPercent(text: string): { ok: true; value: number | null } | { ok: false } {
  return parsePercentBp(text);
}

// ---------------------------------------------------------------------------
// Bank accounts
// ---------------------------------------------------------------------------

export type BankForm = { bankName: string; branch: string; accountName: string; accountNo: string; ifsc: string; note: string; makeDefault: boolean };

export const EMPTY_BANK: BankForm = { bankName: "", branch: "", accountName: "", accountNo: "", ifsc: "", note: "", makeDefault: false };

export type BankProblems = Partial<Record<"bankName" | "accountName" | "accountNo" | "ifsc", MessageKey>>;

export function bankProblems(form: BankForm): BankProblems {
  const out: BankProblems = {};
  if (!form.bankName.trim()) out.bankName = "adm.masters.bank.form.bankNameRequired";
  if (!form.accountName.trim()) out.accountName = "adm.masters.bank.form.accountNameRequired";
  if (!isBankAccountNo(form.accountNo)) out.accountNo = "adm.masters.bank.form.accountNoInvalid";
  if (!isIfsc(form.ifsc)) out.ifsc = "adm.masters.bank.form.ifscInvalid";
  return out;
}

/** What goes to the server: spaces out of the account number, the branch code in capitals. */
export function bankPayload(form: BankForm) {
  return {
    bankName: form.bankName.trim(),
    branch: form.branch.trim() || null,
    accountName: form.accountName.trim(),
    accountNo: form.accountNo.replace(/\s+/g, ""),
    ifsc: form.ifsc.trim().toUpperCase(),
    note: form.note.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Transit insurance
// ---------------------------------------------------------------------------

export type InsuranceForm = { policyNo: string; insurer: string; validFrom: string; validTo: string; printOnPl: boolean };
export const EMPTY_INSURANCE: InsuranceForm = { policyNo: "", insurer: "", validFrom: "", validTo: "", printOnPl: true };

export type InsuranceProblems = Partial<Record<"policyNo" | "insurer" | "validTo", MessageKey>>;

export function insuranceProblems(form: InsuranceForm): InsuranceProblems {
  const out: InsuranceProblems = {};
  if (!form.policyNo.trim()) out.policyNo = "adm.masters.rules.insurance.policyRequired";
  if (!form.insurer.trim()) out.insurer = "adm.masters.rules.insurance.insurerRequired";
  if (form.validFrom && form.validTo && form.validTo < form.validFrom) out.validTo = "adm.masters.rules.insurance.endsBeforeStart";
  return out;
}

export type InsuranceState = "none" | "open" | "valid" | "soon" | "expired" | "notStarted";

/** Where the policy stands today (plant calendar day): `soon` is the last 30 days. */
export function insuranceState(ins: { validFrom: string | null; validTo: string | null } | null, today: string): InsuranceState {
  if (!ins) return "none";
  if (ins.validFrom && today < ins.validFrom) return "notStarted";
  if (!ins.validTo) return "open";
  if (today > ins.validTo) return "expired";
  const days = Math.round((Date.parse(`${ins.validTo}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days <= 30 ? "soon" : "valid";
}

// ---------------------------------------------------------------------------
// Document register
// ---------------------------------------------------------------------------

export const DOC_KINDS = ["procedure", "customer_spec", "drawing", "certificate", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export type DocForm = { title: string; kind: DocKind; version: string; reviewOn: string; notes: string };
export const EMPTY_DOC: DocForm = { title: "", kind: "procedure", version: "", reviewOn: "", notes: "" };

export function docProblems(form: DocForm): Partial<Record<"title", MessageKey>> {
  return form.title.trim() ? {} : { title: "adm.masters.documents.form.titleRequired" };
}

export function docPayload(form: DocForm) {
  return {
    title: form.title.trim(),
    kind: form.kind,
    version: form.version.trim() || null,
    reviewOn: form.reviewOn || null,
    notes: form.notes.trim() || null,
  };
}

export type DocFileKind = "image" | "pdf" | "cdr" | "dwg";

/** The kind of file a picked file is, by name and type; null when the register takes no such file. */
export function docFileKind(file: { name: string; type: string }): DocFileKind | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (file.type.startsWith("image/")) return "image";
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (ext === "cdr") return "cdr";
  if (ext === "dwg") return "dwg";
  return null;
}

/** The type the server checks: images by type or extension, PDF as PDF, CDR and DWG blank. */
export function docMimeFor(kind: DocFileKind, file: { name: string; type: string }): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "cdr" || kind === "dwg") return "";
  if (file.type.startsWith("image/")) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

export const DOC_FILE_ACCEPT = "image/*,.pdf,.cdr,.dwg";

/** A file's size in the words a person uses: "820 KB", "3.4 MB". */
export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Tool room
// ---------------------------------------------------------------------------

export const TOOLING_TYPES = ["bolster", "backer", "die_ring", "container", "liner", "other"] as const;
export type ToolingType = (typeof TOOLING_TYPES)[number];

export const TOOLING_ADD_STATUSES = ["awaiting_inspection", "in_store", "in_use"] as const;
export const TOOLING_HAND_STATUSES = ["in_store", "in_use", "at_maker", "retired"] as const;
export type ToolingStatus = "awaiting_inspection" | "in_store" | "in_use" | "at_maker" | "failed" | "retired";

export function toolingStatusTone(status: ToolingStatus): StatusTone | null {
  switch (status) {
    case "in_use":
      return "blue";
    case "awaiting_inspection":
    case "at_maker":
      return "amber";
    case "failed":
      return "red";
    case "retired":
      return "neutral";
    default:
      return null;
  }
}

export type ToolingForm = { type: ToolingType; code: string; size: string; location: string; makerName: string; notes: string; status: (typeof TOOLING_ADD_STATUSES)[number] };
export const EMPTY_TOOLING: ToolingForm = { type: "bolster", code: "", size: "", location: "", makerName: "", notes: "", status: "awaiting_inspection" };

export function toolingProblems(form: ToolingForm): Partial<Record<"code", MessageKey>> {
  return form.code.trim() ? {} : { code: "adm.masters.tooling.form.codeRequired" };
}

const orNull = (s: string) => s.trim() || null;

export function toolingCreatePayload(form: ToolingForm) {
  return {
    type: form.type,
    code: form.code.trim(),
    size: orNull(form.size),
    location: orNull(form.location),
    makerName: orNull(form.makerName),
    notes: orNull(form.notes),
    status: form.status,
  };
}

/** The minimum stock typed per type: blanks mean none (0); a non-number is refused as null. */
export function minStockFromText(texts: Record<string, string>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const [type, text] of Object.entries(texts)) {
    const p = parseWholeNumber(text, { min: 0, max: MAX_TOOLING_MIN });
    if (!p.ok) return null;
    if (p.value) out[type] = p.value;
  }
  return out;
}


// ---------------------------------------------------------------------------
// Server refusals
// ---------------------------------------------------------------------------

/**
 * The server's English refusals of these routers as i18n keys, so a Hindi screen never shows English.
 * Anything else goes through the masters mapper (generic line, forbidden, not found).
 */
export function admErrorKey(error: unknown): ErrorView {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? "");
  const code = (error as { data?: { code?: string } | null } | null)?.data?.code;
  let m: RegExpMatchArray | null;
  if ((m = message.match(/^"(.+)" is already on this list$/))) return { key: "adm.masters.errors.nameTaken", vars: { name: m[1]! } };
  if (/Only a die category has an expected life/.test(message)) return { key: "adm.masters.errors.lifeOnlyDie" };
  if (/account number must be 6 to 20 digits/.test(message)) return { key: "adm.masters.bank.form.accountNoInvalid" };
  if (/IFSC must be 11 characters/.test(message)) return { key: "adm.masters.bank.form.ifscInvalid" };
  if (/Bring the account back before/.test(message)) return { key: "adm.masters.errors.bankRetired" };
  if (/policy ends before it starts/.test(message)) return { key: "adm.masters.rules.insurance.endsBeforeStart" };
  if (/prefix may hold letters/.test(message)) return { key: "adm.masters.rules.formats.problem.prefixChars" };
  if (/prefix may be at most/.test(message)) return { key: "adm.masters.rules.formats.problem.prefixLength" };
  if (/must show the year/.test(message)) return { key: "adm.masters.rules.formats.problem.yearRequired" };
  if (/Padding is 0 to/.test(message)) return { key: "adm.masters.rules.formats.problem.pad" };
  if ((m = message.match(/^(.+) is already a tooling piece here$/))) return { key: "adm.masters.errors.toolingCodeTaken", vars: { code: m[1]! } };
  if (/waiting for its receive inspection/.test(message)) return { key: "adm.masters.errors.toolingAwaiting" };
  if (/failed its receive inspection/.test(message)) return { key: "adm.masters.errors.toolingFailed" };
  if (/ is retired$/.test(message)) return { key: "adm.masters.errors.toolingRetired" };
  if (/Say what failed/.test(message)) return { key: "adm.masters.tooling.inspect.notesRequired" };
  if (/upload has expired/.test(message)) return { key: "adm.masters.documents.errors.expired" };
  if (/file has not arrived|did not arrive whole/.test(message)) return { key: "adm.masters.documents.errors.notWhole" };
  if (code === "PRECONDITION_FAILED") return { key: "adm.masters.documents.errors.noStorage" };
  return masterErrorKey(error);
}

/** True when a document upload was refused because the stage has no file storage. */
export function isNoStorage(error: unknown): boolean {
  return (error as { data?: { code?: string } | null } | null)?.data?.code === "PRECONDITION_FAILED";
}
