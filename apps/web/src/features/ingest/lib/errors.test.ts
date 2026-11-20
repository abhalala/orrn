import { describe, expect, test } from "bun:test";

import { beginRefusalWords, ingestErrorWords } from "./errors";
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

describe("chunked upload sentences (limits brief part B)", () => {
  // Verbatim from packages/server/src/lib/ingest/upload-parts.ts: a new sentence there needs a line here and in UPLOAD_SENTENCES.
  const said = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });
  test("each server sentence has words of its own and can be tried again", () => {
    expect(ingestErrorWords(said("BAD_REQUEST", "Some parts of the file have not arrived. Add the same file again to send them."), "action")).toEqual({ key: "ingest.upload.error.partsMissing", retry: true });
    expect(ingestErrorWords(said("BAD_REQUEST", "The file does not match its digest"), "action")).toEqual({ key: "ingest.upload.error.digest", retry: true });
    expect(ingestErrorWords(said("BAD_REQUEST", "The upload ran out. Add the same file again."), "action")).toEqual({ key: "ingest.upload.error.ranOut", retry: true });
  });

  test("fix round: the whole-file check and another person's upload have their words; a failed check is not retried", () => {
    expect(ingestErrorWords(said("CONFLICT", "This file is still being checked. Try again in a minute."), "action")).toEqual({ key: "ingest.upload.error.checkRunning", retry: true });
    expect(ingestErrorWords(said("CONFLICT", "Someone else is sending this file now. Try again when they finish."), "action")).toEqual({ key: "ingest.upload.error.someoneElse", retry: true });
    expect(ingestErrorWords(said("BAD_REQUEST", "orrn could not check this file after it arrived. Remove it and add it again."), "action")).toEqual({ key: "ingest.upload.error.checkFailed", retry: false });
  });

  test("fix round: begin refusals that name a file or a limit become a problem line with their values", () => {
    const e = (m: string) => new Error(m);
    expect(beginRefusalWords(e("big book.xlsx is too big. The limit for this kind of file is 20 MB."))).toEqual({ key: "ingest.upload.refused.tooBigKind", vars: { name: "big book.xlsx", limit: "20" } });
    expect(beginRefusalWords(e("a.csv is too big. The largest file for this plant is 100 MB. Godseye staff can raise it."))).toEqual({ key: "ingest.upload.refused.fileTooBig", vars: { name: "a.csv", size: "100 MB" } });
    expect(beginRefusalWords(e("a.pdf is too big. The largest file orrn can take is 2 GB."))).toEqual({ key: "ingest.upload.refused.fileTooBigMax", vars: { name: "a.pdf", size: "2 GB" } });
    expect(beginRefusalWords(e("This plant's file storage is full (50 GB). Godseye staff can raise it."))).toEqual({ key: "ingest.upload.refused.storageFull", vars: { size: "50 GB" } });
    expect(beginRefusalWords(e("This plant's file storage is full (1024 GB)."))).toEqual({ key: "ingest.upload.refused.storageFullMax", vars: { size: "1024 GB" } });
    expect(beginRefusalWords(e("Too many rows are waiting. Merge or discard older imports first."))).toBeNull();
  });
});
