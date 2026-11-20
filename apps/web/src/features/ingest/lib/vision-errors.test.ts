import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";

import { ingestErrorWords } from "./errors";

/**
 * Every server sentence of the vision read (contract section 8b) has plain words in English and Hindi, and never falls
 * to the generic "orrn cannot do this yet" with the server's English under it. The sentences are read from the
 * contract itself, so a line added there fails here until the web maps it.
 */

const ROOT = join(import.meta.dir, "../../../../../..");
const CONTRACT = readFileSync(join(ROOT, "docs/superpowers/plans/2026-11-20-vision-read.md"), "utf8");
const SERVER_TYPES = readFileSync(join(ROOT, "packages/server/src/lib/ingest/types.ts"), "utf8");

function section8b(): string {
  const start = CONTRACT.indexOf("## 8b.");
  const end = CONTRACT.indexOf("\n## ", start + 1);
  return CONTRACT.slice(start, end === -1 ? undefined : end);
}

/** The sentences quoted in 8b, and the named constants resolved from the server's types. */
function sentences(): string[] {
  const text = section8b();
  const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const named = [...text.matchAll(/`(KEPT_UNREAD_[A-Z_]+)`/g)].map((m) => {
    const found = SERVER_TYPES.match(new RegExp(`export const ${m[1]} = "([^"]+)"`));
    expect({ name: m[1], found: Boolean(found) }).toEqual({ name: m[1], found: true });
    return found![1]!;
  });
  return [...quoted, ...named];
}

const get = (tree: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);

const refusal = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });

describe("vision read refusals have words", () => {
  test("the contract lists the sentences this test reads", () => {
    expect(sentences().length).toBeGreaterThanOrEqual(14);
  });

  test("each sentence, under any code the server may send it with, has its own words in English and Hindi", () => {
    for (const sentence of sentences()) {
      for (const code of ["BAD_REQUEST", "PRECONDITION_FAILED", "NOT_FOUND"]) {
        const words = ingestErrorWords(refusal(code, sentence), "action");
        expect({ sentence, code, generic: words.key === "ingest.error.refused" || words.key === "ingest.error.action", detail: words.detail }).toEqual({ sentence, code, generic: false, detail: undefined });
        expect({ sentence, en: typeof get(en, words.key), hi: typeof get(hi, words.key) }).toEqual({ sentence, en: "string", hi: "string" });
      }
    }
  });

  test("the rows sentence does not say columns", () => {
    const words = ingestErrorWords(refusal("BAD_REQUEST", "Rows of this sheet are already written. Its rows cannot change now."), "action");
    expect(words.key).toBe("ingest.vision.error.rowsWritten");
    const columns = ingestErrorWords(refusal("BAD_REQUEST", "Rows of this sheet are already written. Its columns cannot change now."), "action");
    expect(columns.key).toBe("ingest.error.alreadyWritten");
  });

  test("MOVED is a conflict: the page refreshes and the person tries again", () => {
    const words = ingestErrorWords(refusal("CONFLICT", "This import changed in another tab. Reload and try again."), "action");
    expect(words.key).toBe("ingest.error.conflict");
  });
});
