import { describe, expect, test } from "bun:test";
import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import { INGEST_TARGETS, TARGETS } from "@orrn/ingest";

import { fitKeyOf, groupKey, questionView, reasonLine, decisionOptions, GROUP_ORDER, rowStateKey, STATE_KEY, TARGET_KEY, unitLabelKey } from "./model";
import { ENUM_VALUE_KEYS } from "./row-values";
import { KNOWN_REFUSAL_CODES } from "./refusals";
import { fieldLabelKey } from "./recipe-builder";
import { CANDIDATE_STATES, QUESTION_CODES, ROW_STATES } from "./types";
import { unitsFor, UNIT_KINDS, type UnitKind } from "@orrn/ingest";

/** Review E32: every key the logic emits is in both dictionaries, so no screen can show a raw key. */
function get(tree: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);
}
const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?::[^}]*)?\}/g)].map((m) => m[1]!))].sort().join(",");

function expectKey(key: string) {
  for (const [name, tree] of [["en", en], ["hi", hi]] as const) {
    const value = get(tree, key);
    expect({ lang: name, key, text: typeof value }).toEqual({ lang: name, key, text: "string" });
  }
  expect({ key, vars: vars(get(hi, key) as string) }).toEqual({ key, vars: vars(get(en, key) as string) });
}

describe("dictionary keys the logic emits", () => {
  test("candidate states, groups, targets, fits", () => {
    for (const s of CANDIDATE_STATES) expectKey(STATE_KEY(s));
    for (const g of GROUP_ORDER) expectKey(groupKey(g));
    for (const t of INGEST_TARGETS) expectKey(TARGET_KEY(t));
    for (const f of ["exact", "near", "none", "manual", "bot"] as const) expectKey(fitKeyOf(f));
  });
  test("row states and decisions", () => {
    for (const s of ROW_STATES) {
      const key = rowStateKey(s);
      if (key) expectKey(key);
    }
    for (const state of ["ambiguous", "conflict", "ready_create"] as const) {
      for (const o of decisionOptions({ state, options: [{ id: "x", label: "X" }], mergeState: "open" })) expectKey(o.key);
    }
  });
  test("every question sentence and every answer button", () => {
    for (const code of QUESTION_CODES) {
      const q = questionView({ code, subject: "x", params: {}, answer: null, open: true });
      expectKey(q.key);
      if (q.control.kind === "choice") for (const o of q.control.options) if (o.labelKey) expectKey(o.labelKey);
    }
  });
  test("every hold reason the server writes", () => {
    for (const code of ["merge_failed", "dependency_held", "customer_missing", "module_off", "confirm_blocked", "read_failed"]) {
      const line = reasonLine(code, "detail");
      expect(line?.key).toBeTruthy();
      expectKey(line!.key!);
    }
  });
  test("every refusal code and every target field has words", () => {
    for (const code of KNOWN_REFUSAL_CODES) expectKey(`ingest.refuse.${code}`);
    for (const t of INGEST_TARGETS) for (const f of TARGETS[t].fields) expectKey(fieldLabelKey(f.name));
  });
  test("the error words and the order blockers a merge can quote", () => {
    for (const k of ["conflict", "forbidden", "notFound", "network", "busy", "load", "action"]) expectKey(`ingest.error.${k}`);
    for (const k of ["po_number", "no_lines", "line", "pcs", "kg", "length", "alloy", "temper", "die_or_tier"]) expectKey(`orders.blockers.${k}`);
  });
  test("the words the review asked for exist", () => {
    for (const k of [
      "ingest.q.leaveRatesOut", "ingest.q.ownerMerges", "ingest.merge.planning", "ingest.merge.stopped", "ingest.merge.open",
      "ingest.vault.stored", "ingest.vault.pending", "ingest.drop.wrongType", "ingest.drop.left", "ingest.read.stalled",
      "ingest.period.fy", "ingest.period.asOf", "ingest.shape.target", "ingest.shape.unitAsk",
    ]) expectKey(k);
  });
  test("fit labels, orrn-made and person-made layouts included", () => {
    for (const k of ["fit.exact", "fit.near", "fit.none", "fit.nearNamed", "fit.bot", "fit.manual"]) expectKey(`ingest.${k}`);
    for (const f of ["bot", "manual"] as const) expectKey(fitKeyOf(f));
  });
  test("every unit a column can be read in has words, and so does every enum value a row shows", () => {
    for (const kind of UNIT_KINDS as readonly UnitKind[]) for (const unit of unitsFor(kind)) expectKey(unitLabelKey(unit));
    for (const v of ENUM_VALUE_KEYS) expectKey(`ingest.enumValue.${v}`);
    for (const t of INGEST_TARGETS) for (const f of TARGETS[t].fields) if (f.enum) for (const v of f.enum) expect(ENUM_VALUE_KEYS).toContain(v);
  });
  test("the words of the screens work order (section 5)", () => {
    for (const k of [
      "lead", "drop.add", "drop.note", "drop.openIt", "drop.listLabel", "drop.done", "drop.seenBefore",
      "state.questions", "list.newTable", "list.tables", "list.tablesNoDate", "list.ready", "list.importsUnit", "list.mergeMeta", "list.bar",
      "action.mergeAll", "action.mergeNone", "action.review", "action.mapColumns", "action.checkLayout", "action.approveAll",
      "action.approveBlocked", "action.release", "action.approveAsIs", "action.goMerge", "action.nextNeedsYou", "action.approvedSoFar",
      "action.heldDone", "action.more", "action.seeFile", "discard.title", "discard.body", "discard.keep",
      "hold.title", "hold.owner", "hold.wrongFile", "hold.fixFirst", "effect.line", "effect.refused", "effect.nothing",
      "effect.processing", "effect.needsShape", "effect.failed", "effect.approved", "effect.merged", "effect.discarded",
      "read.title", "read.summary", "read.change", "read.progress", "read.working", "near.title", "near.reject", "near.changedTitle",
      "near.saved", "near.now", "near.kindRenamed", "near.kindNew", "near.kindMissing",
      "shape.title", "shape.choose", "shape.suggested", "shape.samples", "shape.preview", "shape.willNotImport", "shape.required",
      "shape.usedBy", "shape.namePlaceholder", "shape.allMapped", "shape.duplicate", "shape.recipeInvalid", "shape.fixCount",
      "shape.save", "shape.explain", "shape.auto", "shape.ignore", "shape.gaveUp", "shape.capped", "shape.saveAs", "shape.field",
      "shape.missingRequired", "shape.targetRequired", "kind.number", "kind.text", "kind.date", "kind.empty",
      "questions.title", "q.addIt", "q.skipRows", "q.answered", "q.change", "q.aboutRow", "q.create_legacy_die", "q.new_customers",
      "q.magnitude_check", "q.magnitude_checkHint", "q.magnitudeAsIs", "q.magnitudeUnit", "q.magnitudeSkip", "q.sideAbove", "q.sideBelow", "q.sideEither",
      "rows.title", "rows.needsDecision", "rows.needsDecisionName", "rows.choice", "rows.page", "rows.showAll", "rows.showing", "rows.column",
      "rows.waitsOnQuestion", "decide.named", "decide.group", "row.entered",
      "period.ask", "period.guess", "period.noGuess", "period.whyOrders", "period.whyBundles", "period.save", "period.done", "period.doneNoYear",
      "period.change", "period.mismatch", "period.source.title", "period.source.file_name", "period.source.sheet_name",
      "period.source.date_column", "period.source.bundle_no", "period.source.legacy_code",
      "merge.titleRunning", "merge.titleDone", "merge.titleStopped", "merge.rowsUnit", "merge.rowsAdded", "merge.updatedMeta",
      "merge.notMergedMeta", "merge.partsWritten", "merge.listTitle", "merge.added", "merge.addedOf", "merge.updated", "merge.back", "merge.see",
      "merge.rest", "merge.started", "merge.confirmTitle", "merge.confirmNote", "merge.notYet", "merge.announceDone", "merge.running",
      "merge.done", "merge.holds", "merge.otherTab", "reason.merge_failed", "vision.check", "bulk.title", "bulk.body", "bulk.confirm",
      "file.table", "file.columnsIn", "file.subtitle", "file.subtitleNoName", "docTitle.list", "docTitle.page", "docTitle.review",
      "vault.off", "helper.off", "state.needs_shape", "state.needs_confirm",
    ]) expectKey(`ingest.${k}`);
  });
  test("every row reason the server sends has words", () => {
    for (const k of [
      "magnitude", "magnitude_unit", "magnitude_confirmed", "no_weight", "nothing_left", "no_cut_length", "line_invalid", "line_invalidField",
      "status_not_allowed", "alias_is_name", "order_exists", "order_line_new", "in_file_duplicate_same", "cell_cut", "row_cut",
      "over_dispatched", "no_quantity", "section_unknown",
    ]) expectKey(`ingest.refuse.${k}`);
  });
});
