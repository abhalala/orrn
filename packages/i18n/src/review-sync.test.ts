import { expect, test } from "bun:test";
import { buildHindiReview, REVIEW_PATH } from "../scripts/export-review";

test("docs/superpowers/review/hindi-review.md matches the dictionaries (run `bun run export-review`)", async () => {
  const file = Bun.file(REVIEW_PATH);
  expect(await file.exists()).toBe(true);
  expect(await file.text()).toBe(buildHindiReview());
});
