/**
 * Switching plants (units layer): after a person picks another plant the screens wait until `me` carries that plant's
 * units. A kilogram plant's `me` in hand while a pound plant is awaited renders neither a value nor an entry box.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider, useT } from "@orrn/i18n";

const { trpc } = await import("../utils/trpc");
const { TenantFmtProvider } = await import("./tenant-fmt");
const { useFmt } = await import("./fmt");
const { PlantInput } = await import("../components/plant-input");
const { clearExpectedPlant, expectPlant } = await import("./plant-sync");
const { MASS_KG } = await import("./plant-input");

afterEach(() => clearExpectedPlant());

const KG_PLANT = { id: "plant-kg", name: "Kilo", role: "owner", settings: { timezone: "Asia/Kolkata" }, modules: {}, units: screenPrefs({}) };
const LB_PLANT = { id: "plant-lb", name: "Pound", role: "owner", settings: { timezone: "Asia/Kolkata" }, modules: {}, units: screenPrefs({ units: { mass: "lb" } }) };

function Screen() {
  const { t } = useT();
  const fmt = useFmt();
  return (
    <div>
      <p data-testid="total">{t("units.bundlesKg", { bundles: 3, kg: fmt.n("order.weight", 5_000_000, "total") })}</p>
      <PlantInput spec={MASS_KG} value="" onValueChange={() => {}} aria-label="Weight" />
    </div>
  );
}

function render(held: typeof KG_PLANT) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(
    trpc.auth.me.queryOptions().queryKey,
    { user: { id: "u", name: "A", email: "a@x.in" }, company: held, permissions: [] } as never,
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <TenantFmtProvider>
          <Screen />
        </TenantFmtProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("a switch from a kilogram plant to a pound plant", () => {
  test("before any switch the plant's own screens render, in its unit", () => {
    const html = render(KG_PLANT);
    expect(html).toContain("kg");
    expect(html).not.toContain(" lb");
  });

  test("while the kilogram plant's me is still in hand, nothing renders: no value, no entry box, no kg", () => {
    expectPlant(LB_PLANT.id);
    const html = render(KG_PLANT);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("kg");
    expect(html).not.toContain("<input");
    expect(html).not.toContain('data-testid="total"');
  });

  test("once me carries the pound plant, the screen renders with lb and no kg", () => {
    expectPlant(LB_PLANT.id);
    const html = render(LB_PLANT);
    expect(html).toContain('data-testid="total"');
    expect(html).toContain("11,023.1");
    expect(html).toContain("lb");
    expect(html).not.toContain("kg");
    expect(html).toContain("<input");
  });
});

describe("the provider is keyed on the company id", () => {
  test("a second plant builds a new provider, not a changed one", () => {
    expect(readFileSync(join(import.meta.dir, "tenant-fmt.tsx"), "utf8")).toContain("key: companyId");
  });
  test("the plant switcher expects the new plant before it leaves the page", () => {
    const src = readFileSync(join(import.meta.dir, "../../shell/plant-switcher.tsx"), "utf8");
    expect(src.indexOf("expectPlant(")).toBeGreaterThan(-1);
    expect(src.indexOf("expectPlant(")).toBeLessThan(src.indexOf("await navigate("));
  });
});
