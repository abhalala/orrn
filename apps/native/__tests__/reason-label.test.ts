/**
 * W4-MASTERS review m-2: the native reason wording follows the web rule. The Hindi / Gujarati the
 * plant typed wins; a standard code on its standard wording shows the built-in translation; a renamed
 * or plant-added code shows its own English wording (never the built-in translation of its key).
 */
import { describe, expect, test } from "bun:test";

import type { Translate } from "@orrn/i18n";

import { reasonCodeText, reasonLabel, reasonOptions } from "../features/press/reason-label";

const hi: Record<string, string> = { "reasons.downtime.power": "बिजली कटौती" };
const t = ((key: string) => hi[key] ?? key) as Translate;

describe("native reasonLabel", () => {
  test("typed wording in the reader's language first", () => {
    expect(reasonLabel(t, "downtime", "power", "Power cut", { labelHi: "लाइट गई", standard: true }, "hi")).toBe("लाइट गई");
    expect(reasonLabel(t, "downtime", "crane", "Crane", { labelGu: "ક્રેન", standard: false }, "gu")).toBe("ક્રેન");
  });

  test("standard wording shows the built-in translation; a rename shows the plant's wording", () => {
    expect(reasonLabel(t, "downtime", "power", "Power cut", { standard: true }, "hi")).toBe("बिजली कटौती");
    expect(reasonLabel(t, "downtime", "power", "Mains power cut", { standard: false }, "hi")).toBe("Mains power cut");
    expect(reasonLabel(t, "qc_reject", "bend", "bend")).toBe("bend");
  });

  test("options drop retired codes and keep plant-added ones; saved codes read from the plant's row", () => {
    const rows = [
      { code: "power", label: "Power cut", standard: true },
      { code: "old", label: "Old", active: false },
      { code: "crane", label: "Crane", labelHi: "क्रेन", requiresNote: true },
    ];
    expect(reasonOptions(t, "downtime", rows, "hi")).toEqual([
      { value: "power", label: "बिजली कटौती", requiresNote: false },
      { value: "crane", label: "क्रेन", requiresNote: true },
    ]);
    expect(reasonCodeText(t, "downtime", "crane", rows, "hi")).toBe("क्रेन");
  });
});
