import { describe, expect, test } from "bun:test";

import type { Translate } from "@orrn/i18n";

import { reasonCodeText, reasonLabel, reasonOptions } from "./reason-label";

// A Hindi reader's dictionary with one built-in translation; any other key comes back as itself.
const hi: Record<string, string> = { "reasons.downtime.power": "बिजली कटौती" };
const t = ((key: string) => hi[key] ?? key) as Translate;

describe("reasonLabel fallback order (W4-MASTERS review I-2)", () => {
  test("1. the wording the plant typed in the reader's language wins", () => {
    expect(reasonLabel(t, "downtime", "power", "Power cut", { labelHi: "लाइट गई", standard: true }, "hi")).toBe("लाइट गई");
    expect(reasonLabel(t, "downtime", "crane_busy", "Crane busy", { labelGu: "ક્રેન વ્યસ્ત", standard: false }, "gu")).toBe("ક્રેન વ્યસ્ત");
  });

  test("2. a standard code on its standard wording shows the built-in translation", () => {
    expect(reasonLabel(t, "downtime", "power", "Power cut", { standard: true }, "hi")).toBe("बिजली कटौती");
    // Typed Gujarati does not help a Hindi reader.
    expect(reasonLabel(t, "downtime", "power", "Power cut", { labelGu: "વીજળી ગઈ", standard: true }, "hi")).toBe("बिजली कटौती");
    // No wording at all (an old read) with the code as label: still the built-in translation.
    expect(reasonLabel(t, "downtime", "power", "power")).toBe("बिजली कटौती");
  });

  test("the station downtime row (no standard flag sent, label differs from code) is no longer built-in: the server must send it", () => {
    // This is the regression the review found: without `standard` the English label shows.
    expect(reasonLabel(t, "downtime", "power", "Power cut", {}, "hi")).toBe("Power cut");
    expect(reasonLabel(t, "downtime", "power", "Power cut", { standard: true }, "hi")).toBe("बिजली कटौती");
  });

  test("3. a renamed or plant-added code shows its own English wording", () => {
    expect(reasonLabel(t, "downtime", "power", "Mains power cut", { standard: false }, "hi")).toBe("Mains power cut");
    expect(reasonLabel(t, "downtime", "crane_busy", "Crane busy", { standard: false }, "hi")).toBe("Crane busy");
  });

  test("a standard code with no built-in translation falls back to its label, then its code", () => {
    expect(reasonLabel(t, "downtime", "die_change", "Die change", { standard: true }, "hi")).toBe("Die change");
    expect(reasonLabel(t, "downtime", "die_change", "", { standard: true }, "hi")).toBe("die_change");
  });
});

describe("reasonOptions: pickers read the plant's codes (W4-MASTERS review I-3)", () => {
  const rows = [
    { code: "power", label: "Power cut", standard: true, requiresNote: false },
    { code: "crane_busy", label: "Crane busy", labelHi: "क्रेन व्यस्त", standard: false, requiresNote: true },
    { code: "retired", label: "Retired", standard: false, active: false },
    { code: "other", label: "Other", standard: true, requiresNote: false },
  ];

  test("plant-added codes appear, retired codes vanish, wording follows the reader", () => {
    expect(reasonOptions(t, "downtime", rows, "hi")).toEqual([
      { value: "power", label: "बिजली कटौती", requiresNote: false },
      { value: "crane_busy", label: "क्रेन व्यस्त", requiresNote: true },
      { value: "other", label: "Other", requiresNote: true },
    ]);
    expect(reasonOptions(t, "downtime", undefined)).toEqual([]);
  });

  test("a saved code reads from the plant's row, else falls back to the built-in translation or the code", () => {
    expect(reasonCodeText(t, "downtime", "crane_busy", rows, "hi")).toBe("क्रेन व्यस्त");
    expect(reasonCodeText(t, "downtime", "power", undefined, "hi")).toBe("बिजली कटौती");
    expect(reasonCodeText(t, "downtime", "gone", rows, "hi")).toBe("gone");
  });
});
