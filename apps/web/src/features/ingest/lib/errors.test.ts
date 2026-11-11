import { describe, expect, test } from "bun:test";

import { ingestErrorWords } from "./errors";
import { blockerWords, KNOWN_REFUSAL_CODES, refusalLine, refusalLines, refusalText } from "./refusals";

const trpc = (code: string) => Object.assign(new Error(`server words for ${code}`), { data: { code } });

describe("error words", () => {
  test("each failure gets its own words, never the server's message", () => {
    expect(ingestErrorWords(trpc("CONFLICT"), "action")).toEqual({ key: "ingest.error.conflict", retry: false });
    expect(ingestErrorWords(trpc("FORBIDDEN"), "action").key).toBe("ingest.error.forbidden");
    expect(ingestErrorWords(trpc("NOT_FOUND"), "load").key).toBe("ingest.error.notFound");
    expect(ingestErrorWords(trpc("TOO_MANY_REQUESTS"), "action")).toEqual({ key: "ingest.error.busy", retry: true });
    expect(ingestErrorWords(new TypeError("Failed to fetch"), "action")).toEqual({ key: "ingest.error.network", retry: true });
    expect(ingestErrorWords(trpc("BAD_REQUEST"), "load").key).toBe("ingest.error.load");
    expect(ingestErrorWords(trpc("BAD_REQUEST"), "action").key).toBe("ingest.error.action");
    expect(ingestErrorWords(trpc("INTERNAL_SERVER_ERROR"), "action").key).toBe("ingest.error.action");
  });
});

describe("refusal lines", () => {
  test("code and field become a key and the field's label key", () => {
    expect(refusalLine("bad_number:weightMinG")).toEqual({ kind: "refusal", key: "ingest.refuse.bad_number", fieldKey: "ingest.field.weightMinG" });
    expect(refusalLine("total_row")).toEqual({ kind: "refusal", key: "ingest.refuse.total_row", fieldKey: null });
    expect(refusalLine("section_unknown:sectionCode")).toMatchObject({ key: "ingest.refuse.section_unknown", fieldKey: "ingest.field.sectionCode" });
  });
  test("question markers are not shown", () => {
    expect(refusalLine("q:customer_new")).toBeNull();
    expect(refusalLine("q:section_unknown:R 2105")).toBeNull();
    expect(refusalLines(["q:customer_new", "baki_mismatch:bakiKg"])).toHaveLength(1);
  });
  test("confirm_blocked with blocker codes becomes words from the orders dictionary", () => {
    const line = refusalLine("confirm_blocked:po_number, line_1_pcs, line_12_die_or_tier");
    expect(line).toEqual({ kind: "blocked", blockers: ["po_number", "line_1_pcs", "line_12_die_or_tier"] });
    const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
    expect(blockerWords(t, "po_number")).toBe("orders.blockers.po_number");
    expect(blockerWords(t, "line_3_pcs")).toBe('orders.blockers.line{"n":3,"problem":"orders.blockers.pcs"}');
  });
  test("confirm_blocked with a refusal sentence is shown as that sentence", () => {
    expect(refusalLine("confirm_blocked:This order is already confirmed")).toEqual({ kind: "raw", text: "This order is already confirmed" });
  });
  test("an unknown reason is shown as written, an empty one not at all", () => {
    expect(refusalLine("something_new:x")).toEqual({ kind: "raw", text: "something_new:x" });
    expect(refusalLine("")).toBeNull();
  });
  test("text goes through the dictionary with the field's words", () => {
    const t = (key: string, vars?: Record<string, string | number>) => (key === "ingest.refuse.bad_number" ? `${vars?.field} is not a number` : key === "ingest.field.rate" ? "Rate" : key);
    expect(refusalText(t, refusalLine("bad_number:rate")!)).toBe("Rate is not a number");
  });
  test("the merge reason codes the server writes all have words (checked with the dictionary in keys.test)", () => {
    expect(KNOWN_REFUSAL_CODES).toContain("module_off");
    expect(KNOWN_REFUSAL_CODES).toContain("baki_mismatch");
  });
});
