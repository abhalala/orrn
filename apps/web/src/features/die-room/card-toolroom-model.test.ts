import { describe, expect, test } from "bun:test";

import { blocksIssue, inspectionInput } from "./card-toolroom-model";

describe("die card tool room rules", () => {
  test("a fail without notes is refused", () => {
    expect(inspectionInput("fail", "   ")).toEqual({ ok: false });
  });
  test("a fail with notes is sent trimmed", () => {
    expect(inspectionInput("fail", " crack at the bearing ")).toEqual({ ok: true, input: { result: "fail", notes: "crack at the bearing" } });
  });
  test("a pass needs no notes and sends none when empty", () => {
    expect(inspectionInput("pass", "")).toEqual({ ok: true, input: { result: "pass" } });
  });
  test("only a failed copy blocks issue", () => {
    expect(blocksIssue("fail")).toBe(true);
    expect(blocksIssue("pass")).toBe(false);
    expect(blocksIssue(null)).toBe(false);
  });
});
