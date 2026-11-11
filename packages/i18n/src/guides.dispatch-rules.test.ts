import { describe, expect, test } from "bun:test";

import { getGuide } from "./guides";

/**
 * The lead's two-people rule for dispatch requests (AGENTS.md, 2026-11-10): the person who scanned
 * asked and cannot approve; the person who pressed Dispatch may approve. The approvals guide says so.
 */
describe("approvals guide: who may approve a dispatch request (check N5)", () => {
  const fixOf = (locale: "en" | "hi") =>
    getGuide("approvals-review", locale).problems.find((p) => /note|नोट/.test(p.title) && /Dispatch/.test(p.fix))?.fix ?? "";

  test("en: the scanner cannot approve; the person who pressed Dispatch may", () => {
    expect(fixOf("en")).toContain("The person who scanned cannot approve.");
    expect(fixOf("en")).toContain("The person who pressed Dispatch may approve.");
    expect(fixOf("en")).not.toContain("Neither of them");
  });

  test("hi: the same rule", () => {
    expect(fixOf("hi")).toContain("स्कैन करने वाले मंज़ूर नहीं कर सकते।");
    expect(fixOf("hi")).toContain("Dispatch दबाने वाले मंज़ूर कर सकते हैं।");
    expect(fixOf("hi")).not.toContain("इनमें से कोई");
  });
});
