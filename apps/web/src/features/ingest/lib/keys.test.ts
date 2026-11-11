import { describe, expect, test } from "bun:test";
import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import { INGEST_TARGETS, TARGETS } from "@orrn/ingest";

import { fitKeyOf, groupKey, questionView, reasonLine, decisionOptions, GROUP_ORDER, rowStateKey, STATE_KEY, TARGET_KEY } from "./model";
import { KNOWN_REFUSAL_CODES } from "./refusals";
import { fieldLabelKey } from "./recipe-builder";
import { CANDIDATE_STATES, QUESTION_CODES, ROW_STATES } from "./types";

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
    for (const code of ["merge_failed", "dependency_held", "module_off", "confirm_blocked", "read_failed"]) {
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
      "ingest.rate.unit", "ingest.period.fy", "ingest.period.asOf", "ingest.shape.target", "ingest.shape.unitAsk",
    ]) expectKey(k);
  });
});
