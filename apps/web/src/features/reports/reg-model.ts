/**
 * View models of the six XE register pages (`/reports/rejections`, `recuts`, `wip`, `plan-actual`,
 * `unpacked`, `materials`). Every figure is the server's (grams, basis points, minutes); this file
 * only writes them down and builds the CSV text from the same rows the table shows. CSV stays in
 * kg and mm whatever unit the plant shows on screen.
 */
import { bpPercent1 } from "@orrn/domain";
import type { MessageKey, TranslateVars } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { toCsv } from "./model";

type Outputs = inferRouterOutputs<AppRouter>;
export type RejectionsData = Outputs["reports"]["rejections"];
export type RejectionRow = RejectionsData["rows"][number];
export type RecutsData = Outputs["reports"]["recuts"];
export type RecutRow = RecutsData["rows"][number];
export type WipData = Outputs["reports"]["wip"];
export type WipRow = WipData["rows"][number];
export type PlanActualData = Outputs["reports"]["planActual"];
export type PlanActualRow = PlanActualData["rows"][number];
export type UnpackedData = Outputs["reports"]["unpacked"];
export type UnpackedRow = UnpackedData["rows"][number];
export type MaterialsData = Outputs["reports"]["materials"];
export type MaterialClassRow = MaterialsData["classes"][number];

type T = (key: MessageKey, vars?: TranslateVars) => string;

/** Exports stay in kg and mm whatever the plant shows on screen. */
const exportWords = (t: T): T => (key, vars) => t(key, { massUnit: "kg", sectionUnit: "kg/12ft", lengthUnit: "mm", ...vars });

const csvKg = (g: number) => (g / 1000).toFixed(3);

/** One page after another until the server has no next offset (a runaway server answer stops at `maxPages`). */
export async function collectPages<R>(fetchPage: (offset: number) => Promise<{ rows: readonly R[]; nextOffset: number | null }>, maxPages = 200): Promise<R[]> {
  const all: R[] = [];
  let offset: number | null = 0;
  for (let i = 0; i < maxPages && offset !== null; i++) {
    const page: { rows: readonly R[]; nextOffset: number | null } = await fetchPage(offset);
    all.push(...page.rows);
    offset = page.nextOffset;
  }
  return all;
}

/** "75.5" from basis points; null (no plan) is a quiet dash upstream. */
export const achievedText = (bp: number | null): string => (bp == null ? "" : bpPercent1(bp));

/** A signed kg figure for a CSV: negative keeps its minus. */
const csvSignedKg = (g: number) => (g / 1000).toFixed(3);

/** The reason of a rejection row: the label, else the code, else empty. */
export const rejectionReason = (r: { reasonLabel: string; reasonCode: string | null }): string => r.reasonLabel || r.reasonCode || "";

export function rejectionsCsv(rows: readonly RejectionRow[], totals: RejectionsData["totals"], t: T): string {
  t = exportWords(t);
  const header = [
    t("reg.reports.col.day"),
    t("reg.reports.col.source"),
    t("reg.reports.col.run"),
    t("reg.reports.col.section"),
    t("reg.reports.col.copy"),
    t("reg.reports.col.press"),
    t("reg.reports.col.shift"),
    t("reg.reports.col.reason"),
    t("reg.reports.col.pieces"),
    t("reg.reports.col.weight"),
  ];
  const body = rows.map((r) => [
    r.day ?? "",
    t(r.source === "press" ? "reg.reports.rejections.sourcePress" : "reg.reports.rejections.sourcePack"),
    r.runNumber ?? "",
    r.sectionCode,
    r.copyCode ?? "",
    r.pressCode ?? "",
    r.shiftName ?? "",
    rejectionReason(r),
    r.pcs,
    csvKg(r.kgG),
  ]);
  body.push([t("reports.total"), "", "", "", "", "", "", "", totals.pcs, csvKg(totals.kgG)]);
  return toCsv(header, body);
}

export function recutsCsv(rows: readonly RecutRow[], totals: RecutsData["totals"], t: T): string {
  t = exportWords(t);
  const header = [
    t("reg.reports.col.day"),
    t("reg.reports.col.bundle"),
    t("reg.reports.col.section"),
    t("reg.reports.col.copy"),
    t("reg.reports.col.trolleyLength"),
    t("reg.reports.col.cutLength"),
    t("reg.reports.col.pieces"),
    t("reg.reports.col.weight"),
    t("reg.reports.col.kgLost"),
    t("reg.reports.col.reason"),
  ];
  const body = rows.map((r) => [r.day, r.serial, r.sectionCode, r.copyCode ?? "", r.fromLengthMm ?? "", r.lengthMm, r.pcs, csvKg(r.weightG), csvKg(r.lossG), r.reason ?? ""]);
  body.push([t("reports.total"), "", "", "", "", "", totals.pcs, csvKg(totals.weightG), csvKg(totals.lossG), ""]);
  return toCsv(header, body);
}

export const WIP_STAGE_KEYS = ["notPlanned", "planned", "onPress", "ageing", "unpacked", "packed", "dispatched"] as const;
export type WipStageKey = (typeof WIP_STAGE_KEYS)[number];

export function wipCsv(rows: readonly WipRow[], t: T): string {
  t = exportWords(t);
  const header = [
    t("reg.reports.col.order"),
    t("reg.reports.col.po"),
    t("reg.reports.col.party"),
    t("reg.reports.col.line"),
    t("reg.reports.col.section"),
    t("reg.reports.col.cutLength"),
    t("reg.reports.col.baki"),
    ...WIP_STAGE_KEYS.map((k) => `${t(`reg.stage.${k}`)} ${t("reg.reports.col.kgSuffix")}`),
  ];
  const body = rows.map((r) => [r.orderNumber, r.poNumber ?? "", r.customerName, r.lineNo, r.sectionCode, r.cutLengthMm, csvKg(r.bakiG), ...WIP_STAGE_KEYS.map((k) => csvKg(r.wip[k]))]);
  return toCsv(header, body);
}

export const planActualGroupKey = (g: "press" | "die" | "alloy" | "shift"): MessageKey => `reg.reports.planActual.group.${g}` as MessageKey;

/** "Die change 40 min" for one downtime reason of a row. */
export const downtimeReasonText = (r: { label: string; code: string; min: number }, t: T): string => t("reg.reports.planActual.reasonMin", { reason: r.label || r.code, min: r.min });

export function planActualCsv(data: PlanActualData, t: T): string {
  t = exportWords(t);
  const header = [
    t(planActualGroupKey(data.groupBy)),
    t("reg.reports.col.planned"),
    t("reg.reports.col.actual"),
    t("reg.reports.col.gap"),
    t("reg.reports.col.achieved"),
    t("reg.reports.col.downtime"),
    t("reg.reports.col.topReasons"),
  ];
  const body = data.rows.map((r) => [
    r.label,
    csvKg(r.plannedG),
    csvKg(r.actualG),
    csvSignedKg(r.gapG),
    achievedText(r.achievedBp),
    r.downtimeMin,
    r.reasons
      .slice(0, 3)
      .map((x) => downtimeReasonText(x, t))
      .join("; "),
  ]);
  body.push([t("reports.total"), csvKg(data.totals.plannedG), csvKg(data.totals.actualG), csvSignedKg(data.totals.gapG), achievedText(data.totals.achievedBp), data.totals.downtimeMin, ""]);
  return toCsv(header, body);
}

export function unpackedCsv(data: UnpackedData, dateOf: (ms: number) => string, t: T): string {
  t = exportWords(t);
  const header = [t("reg.reports.col.section"), t("reg.reports.col.copy"), t("reg.reports.col.trolleyLines"), t("reg.reports.col.pieces"), t("reg.reports.col.weight"), t("reg.reports.col.oldest")];
  const body = data.rows.map((r) => [r.sectionCode, r.copyCode ?? "", r.lines, r.pcs, csvKg(r.kgG), r.oldestReleasedAt == null ? "" : dateOf(r.oldestReleasedAt)]);
  body.push([t("reports.total"), "", data.totals.lines, data.totals.pcs, csvKg(data.totals.kgG), ""]);
  return toCsv(header, body);
}

export const MATERIAL_CLASS_KEYS = ["metal", "billet", "bundle"] as const;
const MATERIAL_GROUPS = ["opening", "pack", "void", "dispatch", "purchase", "melt", "pack_reject", "press", "cast_tail", "move", "log_receipt", "billet_cut", "foundry_reject"] as const;

/** The plain word of a ledger document kind; an unknown kind shows as the server wrote it. */
export function materialGroupText(group: string, t: T): string {
  return (MATERIAL_GROUPS as readonly string[]).includes(group) ? t(`reg.reports.materials.group.${group}` as MessageKey) : group;
}

export function materialsCsv(data: MaterialsData, t: T): string {
  t = exportWords(t);
  const header = [t("reg.reports.materials.class"), t("reg.reports.materials.part"), t("reg.reports.materials.document"), t("reg.reports.col.weight")];
  const body: (string | number)[][] = [];
  for (const c of data.classes) {
    const cls = t(`reg.reports.materials.cls.${c.class}`);
    body.push([cls, t("reg.reports.materials.opening"), "", csvSignedKg(c.openingG)]);
    for (const x of c.inBy) body.push([cls, t("reg.reports.materials.in"), materialGroupText(x.group, t), csvSignedKg(x.g)]);
    body.push([cls, t("reg.reports.materials.inTotal"), "", csvSignedKg(c.inG)]);
    for (const x of c.outBy) body.push([cls, t("reg.reports.materials.out"), materialGroupText(x.group, t), csvSignedKg(x.g)]);
    body.push([cls, t("reg.reports.materials.outTotal"), "", csvSignedKg(c.outG)]);
    for (const x of c.gapBy) body.push([cls, t("reg.reports.materials.gap"), materialGroupText(x.group, t), csvSignedKg(x.g)]);
    body.push([cls, t("reg.reports.materials.gapTotal"), "", csvSignedKg(c.gapG)]);
    body.push([cls, t("reg.reports.materials.closing"), "", csvSignedKg(c.closingG)]);
  }
  return toCsv(header, body);
}
