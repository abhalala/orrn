import { describe, expect, test } from "bun:test";

import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";

import { AUDIT_SUBJECT_TYPES, subjectPath, subjectTypeFallback, subjectTypeKey } from "./subject-words";

describe("audit subjects in words (BACKLOG 100)", () => {
  test("a subject with a screen opens it; ids are encoded; no id or no screen gives no link", () => {
    expect(subjectPath("sales_order", "abc-1")).toBe("/orders/abc-1");
    expect(subjectPath("packing_list", "a7c0f15d")).toBe("/packing-lists/a7c0f15d");
    expect(subjectPath("die_instance", "c1")).toBe("/dies/copies/c1");
    expect(subjectPath("dispatch", "a/b")).toBe("/dispatch/a%2Fb");
    expect(subjectPath("sales_order", null)).toBeNull();
    expect(subjectPath("approval", "x")).toBeNull();
  });

  test("every subject type with a screen has its words in English and Hindi", () => {
    const get = (dict: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);
    for (const type of AUDIT_SUBJECT_TYPES) {
      const key = subjectTypeKey(type)!;
      expect(typeof get(en, key), `${key} en`).toBe("string");
      expect(typeof get(hi, key), `${key} hi`).toBe("string");
    }
    expect(subjectTypeKey("approval")).toBeNull();
    // L15: words without a screen
    for (const type of ["bundle_transfer", "sales_order_line"]) {
      const key = subjectTypeKey(type)!;
      expect(typeof get(en, key), `${key} en`).toBe("string");
      expect(get(hi, key), `${key} hi`).not.toBe(get(en, key));
      expect(subjectPath(type, "x")).toBeNull();
    }
    expect(subjectTypeFallback("press_alert_threshold")).toBe("Press alert threshold");
  });
});
