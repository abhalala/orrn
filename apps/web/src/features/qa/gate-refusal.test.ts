import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createI18n } from "@orrn/i18n";
import { QA_REFUSALS } from "@orrn/server/lib/qaRefusals";

import { serverRefusal } from "@/features/shared/server-refusal";

import "./hooks";

/**
 * XE parity lane QA: the gates added to pack (first piece, row 24) and the melt (incoming inspection,
 * row 22) refuse with quality sentences. The screens that make those writes load the quality table, so
 * the refusal is said in the person's language, never the server's English.
 */
const SRC = join(import.meta.dir, "..");

describe("quality gates on pack and the melt are said in each language", () => {
  const cases = [
    QA_REFUSALS.first_piece_waiting({ run: "PR-12" }),
    QA_REFUSALS.first_piece_failed({ run: "PR-12" }),
    QA_REFUSALS.lot_waiting({ lot: "LOT-4" }),
    QA_REFUSALS.lot_failed({ lot: "LOT-4" }),
    QA_REFUSALS.bundle_on_qa_hold({ serial: "26J12" }),
  ];

  test("each sentence maps to its own words in en, hi and gu, keeping the number", () => {
    for (const r of cases) {
      const error = { message: r.message, data: { code: r.code } };
      const en = serverRefusal(createI18n("en").t, error);
      expect(en).toBe(r.message);
      for (const lang of ["hi", "gu"] as const) {
        const said = serverRefusal(createI18n(lang).t, error);
        expect(said).not.toBe(r.message);
        expect(said).not.toBe(serverRefusal(createI18n(lang).t, { message: "zz unknown sentence", data: {} }));
        expect(said).toMatch(/PR-12|LOT-4|26J12/);
      }
    }
  });

  test("the pack and foundry screens load the quality table", () => {
    expect(readFileSync(join(SRC, "pack/use-pack-server.ts"), "utf8")).toContain('import "@orrn/i18n/refusal-qa"');
    expect(readFileSync(join(SRC, "foundry/errors.ts"), "utf8")).toContain('import "@orrn/i18n/refusal-qa"');
  });
});
