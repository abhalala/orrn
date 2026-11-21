/**
 * Godseye Limits tab (limits brief, section A): the form maths and what the tab shows for a plant that
 * follows the defaults and one with its own values. Synthetic plants only.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

import { boxText, costBuys, draftCostCents, initialDraft, limitsChange, limitText, limitWords, parseLimit, PLANT_LIMIT_KEYS, PLANT_LIMITS, spendBuys } from "./limits";

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

describe("what the spend buys is the smaller of the money and the day calls (decision 11)", () => {
  test("$50 a day at 300 calls a day: the calls stop first", () => {
    expect(spendBuys({ ...initialDraft({}), dayModelCostCents: "50" })).toEqual({ count: 300, stop: "calls" });
  });
  test("the defaults: $5 buys about 70 parts, under 300 calls, so the money stops first", () => {
    expect(spendBuys(initialDraft({}))).toEqual({ count: 70, stop: "cost" });
  });
  test("the calls box as typed counts, not the saved value", () => {
    expect(spendBuys({ ...initialDraft({ dayModelCalls: 300 }), dayModelCalls: "40" })).toEqual({ count: 40, stop: "calls" });
  });
  test("while either box holds no allowed value the line is left out, never a default in its place (N9)", () => {
    expect(spendBuys({ ...initialDraft({}), dayModelCostCents: "0" })).toBeNull();
    expect(spendBuys({ ...initialDraft({}), dayModelCalls: "abc" })).toBeNull();
  });
});

describe("storage limits (decision 3)", () => {
  test("the largest file is in MB, the plant's storage in GB; both are whole numbers from 1 to the ceiling", () => {
    expect(limitWords("uploadFileMiB", 2048)).toBe("2,048 MB");
    expect(limitWords("vaultQuotaGiB", 1024)).toBe("1,024 GB");
    expect(parseLimit("uploadFileMiB", "2,048")).toBe(2048);
    expect(parseLimit("uploadFileMiB", "2049")).toBeNull();
    expect(parseLimit("vaultQuotaGiB", "1.5")).toBeNull();
    expect(limitText("vaultQuotaGiB", 50)).toBe("50");
  });
});

function render(limits: Record<string, number>, locale: "en" | "hi" | "gu" = "en", platformRole: string | null = "support") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, {
    user: { id: "u", name: "Staff", email: "staff@example.test" },
    company: null,
    isPlatformAdmin: platformRole !== null,
    platformRole,
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
    expect(html).toContain("About 70 parts of busy pages a day");
    expect(html).toContain('value="5.00"');
    expect(html).toContain("Use default");
  });

  test("a plant with its own values shows them and the matching spend sentence", () => {
    const html = render({ dayModelCostCents: 100, filesPerUpload: 4 });
    expect(html.match(/>Set for this plant</g)).toHaveLength(2);
    expect(html).toContain('value="1.00"');
    expect(html).toContain('value="4"');
    expect(html).toContain("About 14 parts of busy pages a day");
  });

  test("$50 a day with 300 calls a day says 300 parts and that the calls stop first", () => {
    const html = render({ dayModelCostCents: 5000 });
    expect(html).toContain("About 300 parts of busy pages a day. The model calls a day stop first.");
    expect(html).not.toContain("About 710");
  });

  test("the storage limits show in MB and GB with their defaults and ceilings", () => {
    const html = render({});
    expect(html).toContain("Largest file per upload");
    expect(html).toContain("Default 2,048 MB");
    expect(html).toContain("Storage for this plant");
    expect(html).toContain("Default 50 GB");
    expect(html).toContain("Up to 1,024 GB");
  });

  test("someone who cannot save limits cannot edit the boxes either (N9)", () => {
    const html = render({}, "en", null);
    const inputs = html.match(/<input[^>]*data-testid="limit-input-[^"]+"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(PLANT_LIMIT_KEYS.length);
    for (const input of inputs) expect(input).toContain('disabled=""');
    expect(render({}).match(/<input[^>]*data-testid="limit-input-[^"]+"[^>]*>/g)!.some((i) => i.includes('disabled=""'))).toBe(false);
  });

  test("Gujarati words render (decision 14)", () => {
    const html = render({}, "gu");
    expect(html).not.toContain("Model spend a day");
    expect(html).not.toContain("Use default");
  });

  test("Hindi words render", () => {
    const html = render({}, "hi");
    expect(html).toContain("रोज़ मॉडल खर्च");
    expect(html).toContain("डिफ़ॉल्ट रखें");
  });
});
