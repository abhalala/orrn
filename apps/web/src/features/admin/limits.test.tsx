/**
 * Godseye Limits tab (limits brief, section A): the form maths and what the tab shows for a plant that
 * follows the defaults and one with its own values. Synthetic plants only.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

import { boxText, costBuys, draftCostCents, initialDraft, limitsChange, limitText, limitWords, parseLimit, PLANT_LIMIT_KEYS, PLANT_LIMITS } from "./limits";

const { trpc } = await import("@/shared/utils/trpc");
const { CompanyLimitsTab } = await import("./company-limits-tab");

describe("limits form", () => {
  test("money is typed in dollars and kept in cents; the rest are whole numbers from 1 to the ceiling", () => {
    expect(parseLimit("dayModelCostCents", "5")).toBe(500);
    expect(parseLimit("dayModelCostCents", "2.5")).toBe(250);
    expect(parseLimit("dayModelCostCents", "0.01")).toBe(1);
    expect(parseLimit("dayModelCostCents", "50.00")).toBe(5000);
    expect(parseLimit("dayModelCostCents", "50.01")).toBeNull();
    expect(parseLimit("dayModelCostCents", "0")).toBeNull();
    expect(parseLimit("dayModelCostCents", "1.234")).toBeNull();
    expect(parseLimit("rawRowsPerFile", "250,000")).toBe(250_000);
    expect(parseLimit("rawRowsPerFile", "2,5")).toBeNull();
    expect(parseLimit("dayModelCalls", "0")).toBeNull();
    expect(parseLimit("dayModelCalls", "1.5")).toBeNull();
    expect(parseLimit("dayModelCalls", "")).toBeNull();
    for (const key of PLANT_LIMIT_KEYS) {
      expect(parseLimit(key, limitText(key, PLANT_LIMITS[key].ceiling))).toBe(PLANT_LIMITS[key].ceiling);
      expect(parseLimit(key, limitText(key, PLANT_LIMITS[key].ceiling + 1))).toBeNull();
    }
  });

  test("only changed keys are sent; Use default sends null; a bad box blocks the save", () => {
    const set = { dayModelCalls: 120, filesPerUpload: 5 };
    const draft = initialDraft(set);
    expect(draft.dayModelCalls).toBe("120");
    expect(draft.rawRowsPerFile).toBeNull();
    expect(boxText("rawRowsPerFile", draft)).toBe("200000");
    expect(limitsChange(set, draft)).toEqual({ change: {}, invalid: [] });
    expect(limitsChange(set, { ...draft, dayModelCalls: "600", filesPerUpload: null, dayModelCostCents: "12.50" })).toEqual({
      change: { dayModelCalls: 600, filesPerUpload: null, dayModelCostCents: 1250 },
      invalid: [],
    });
    expect(limitsChange(set, { ...draft, visionPagesPerBatch: "81" })).toEqual({ change: {}, invalid: ["visionPagesPerBatch"] });
  });

  test("what the day spend buys, at about 7 cents a dense page part", () => {
    expect(costBuys(500)).toBe(70);
    expect(costBuys(1500)).toBe(210);
    expect(costBuys(100)).toBe(14);
    expect(draftCostCents(initialDraft({}))).toBe(500);
    expect(draftCostCents({ ...initialDraft({}), dayModelCostCents: "1" })).toBe(100);
    expect(limitWords("dayModelCostCents", 500)).toBe("$5.00");
    expect(limitWords("openRowsPerPlant", 300_000)).toBe("300,000");
  });
});

function render(limits: Record<string, number>, locale: "en" | "hi" = "en") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, {
    user: { id: "u", name: "Staff", email: "staff@example.test" },
    company: null,
    isPlatformAdmin: true,
    platformRole: "support",
    permissions: [],
  } as never);
  const company = { id: "c1", name: "Synthetic Plant", slug: "synthetic", status: "active", plan: "growth", modules: [], limits, createdAt: new Date(), updatedAt: new Date(), memberCount: 3 };
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>
        <CompanyLimitsTab company={company as never} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("the Limits tab", () => {
  test("a plant on the defaults: every limit says so, with its default and ceiling, and what 5 dollars buys", () => {
    const html = render({});
    expect(html.match(/>Uses the default</g)).toHaveLength(PLANT_LIMIT_KEYS.length);
    expect(html).not.toContain("Set for this plant");
    expect(html).toContain("Model spend a day");
    expect(html).toContain("Default $5.00");
    expect(html).toContain("Up to $50.00");
    expect(html).toContain("Default 300");
    expect(html).toContain("Up to 3,000");
    expect(html).toContain("About 70 dense page parts a day");
    expect(html).toContain('value="5.00"');
    expect(html).toContain("Use default");
  });

  test("a plant with its own values shows them and the matching spend sentence", () => {
    const html = render({ dayModelCostCents: 100, filesPerUpload: 4 });
    expect(html.match(/>Set for this plant</g)).toHaveLength(2);
    expect(html).toContain('value="1.00"');
    expect(html).toContain('value="4"');
    expect(html).toContain("About 14 dense page parts a day");
  });

  test("Hindi words render", () => {
    const html = render({}, "hi");
    expect(html).toContain("रोज़ मॉडल खर्च");
    expect(html).toContain("डिफ़ॉल्ट रखें");
  });
});
