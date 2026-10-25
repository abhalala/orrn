import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";
import { SCAN_REFUSALS } from "@orrn/server/lib/scanRefusal";
import { SCAN_OUTCOMES } from "@orrn/server/lib/scan";

import { REFUSAL_KEYS, resultOutcome, unavailableMessage, type ScanResultRow } from "../features/scan/outcome";
import { GATE_KEYS, PRESS_REFUSALS, pressError, START_REFUSAL_KEYS } from "../features/press/press-model";

const REPO = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);
}

/** The codes of a string-literal union in a source file: `export type X =\n  | "a"\n  | "b";`. */
function unionCodes(source: string, typeName: string): string[] {
  const at = source.indexOf(`export type ${typeName} =`);
  expect(at).toBeGreaterThan(-1);
  const end = source.indexOf(";", at);
  return [...source.slice(at, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

describe("every server scan outcome has a native floor sentence (BACKLOG 29)", () => {
  const row = (outcome: ScanResultRow["outcome"], extra: Partial<ScanResultRow> = {}): ScanResultRow => ({
    code: "S1",
    outcome,
    message: "English from the server",
    bundleId: null,
    serial: "S1",
    heldBy: null,
    customerName: null,
    candidates: [],
    note: null,
    ...extra,
  });

  test("the refusal codes the phone maps are exactly the server's", () => {
    expect(Object.keys(REFUSAL_KEYS).sort()).toEqual([...SCAN_REFUSALS].sort());
  });

  test("SCAN_OUTCOMES: every outcome is added, already on, not found, or a refusal with a key (never the server's English)", () => {
    const calm = new Set(["added", "already_on_dispatch", "not_found"]);
    for (const outcome of SCAN_OUTCOMES) {
      const out = resultOutcome(row(outcome as ScanResultRow["outcome"], { orderNumber: "SO-7", customerName: "Shreeji", heldBy: "D-0007", candidates: ["26J1", "26J2"] }));
      if (calm.has(outcome)) {
        expect(["added", "already", "notFound"]).toContain(out.kind);
      } else {
        expect(out.kind).toBe("rejected");
        if (out.kind === "rejected") expect("key" in out.message).toBe(true);
      }
    }
  });

  test("a refusal without its names still gets a key, not the server's sentence", () => {
    for (const code of SCAN_REFUSALS) {
      const msg = unavailableMessage({ serial: "S1", reason: "English from the server", code });
      expect("key" in msg).toBe(true);
    }
  });

  test("wrong customer and owned die name the person, as the spec asks to be spoken", () => {
    expect(resultOutcome(row("wrong_customer", { customerName: "Shreeji" }))).toMatchObject({ message: { key: "scan.continuous.wrongCustomer", vars: { name: "Shreeji" } } });
    expect(resultOutcome(row("owned_die", { customerName: "Bhavesh Traders" }))).toMatchObject({ message: { key: "scan.continuous.dieOwned", vars: { name: "Bhavesh Traders" } } });
    expect(resultOutcome(row("held_for_order", { orderNumber: "SO-7", customerName: "Shreeji" }))).toMatchObject({ message: { key: "scan.continuous.heldForOrder" } });
    expect(resultOutcome(row("unassigned"))).toMatchObject({ message: { key: "scan.continuous.unassigned" }, code: "unassigned" });
  });

  test("every key a refusal can use exists in English, Hindi and Gujarati", () => {
    const keys = new Set<string>(["scan.notFound", "scan.continuous.already", "scan.continuous.added", "scan.continuous.addedNoOrder", "scan.continuous.wrongStatus", "scan.continuous.overCapacity", "scan.continuous.addAnyway", "scan.continuous.addAnywayHint"]);
    for (const list of Object.values(REFUSAL_KEYS)) for (const k of list) keys.add(k);
    for (const k of keys) {
      for (const [name, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: k, lang: name, text: typeof lookup(dict, k) }).toEqual({ key: k, lang: name, text: "string" });
      }
    }
  });
});

describe("press gates and refusals have native sentences", () => {
  const domain = read("packages/domain/src/pressRun.ts");

  test("every close-gate code the domain can return has a key (and no extra one lingers)", () => {
    expect(Object.keys(GATE_KEYS).sort()).toEqual(unionCodes(domain, "CloseGateError").sort());
  });

  test("every start refusal the domain can return has a key", () => {
    expect(Object.keys(START_REFUSAL_KEYS).sort()).toEqual(unionCodes(domain, "StartRefusal").sort());
  });

  test("gate and start-refusal keys exist in English, Hindi and Gujarati", () => {
    const keys = [...Object.values(GATE_KEYS), ...Object.values(START_REFUSAL_KEYS)];
    for (const k of keys) {
      for (const [name, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: k, lang: name, text: typeof lookup(dict, k) }).toEqual({ key: k, lang: name, text: "string" });
      }
    }
  });

  test("the run statuses are worded in all three languages", () => {
    for (const status of ["queued", "die_issued", "running", "stopped", "counting", "logged", "voided"]) {
      for (const dict of [en, hi, gu]) expect(typeof lookup(dict, `press.console.status.${status}`)).toBe("string");
    }
  });

  test("each server refusal the phone can hit matches its sample, and the server still says it", () => {
    const sources = read("packages/server/src/routers/press.ts") + read("packages/server/src/routers/pressRun.ts");
    for (const r of PRESS_REFUSALS) {
      expect({ sample: r.sample, hit: r.re.test(r.sample) }).toEqual({ sample: r.sample, hit: true });
      expect({ src: r.src, found: sources.includes(r.src) }).toEqual({ src: r.src, found: true });
      for (const [name, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: r.key, lang: name, text: typeof lookup(dict, r.key) }).toEqual({ key: r.key, lang: name, text: "string" });
      }
    }
  });

  test("an unknown server sentence is never shown: the generic line stands in", () => {
    const t = (key: string) => `<${key}>`;
    expect(pressError(t as never, { data: { code: "BAD_REQUEST", httpStatus: 400 }, message: "Some new English sentence" }).text).toBe("<errors.generic>");
    expect(pressError(t as never, { data: { code: "BAD_REQUEST", httpStatus: 400 }, message: "P1 already has downtime running; stop it first" }).text).toBe("<native.press.errors.downtimeRunning>");
  });

  test("no answer from orrn is an unsure write, so the screen looks again instead of repeating it", () => {
    const t = (key: string) => key;
    expect(pressError(t as never, new Error("Network request failed"))).toEqual({ text: "native.saveUnsureBody", unsure: true });
    expect(pressError(t as never, { data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 } }).unsure).toBe(true);
  });
});
