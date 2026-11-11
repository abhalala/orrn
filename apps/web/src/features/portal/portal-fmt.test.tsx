/**
 * A party who switches plant in the portal: the frame shows its loading state until `portal.me` is the new plant's, so a
 * weight is never shown under the old plant's unit, nor under the default words while `portal.me` is read again.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider, useT } from "@orrn/i18n";

const { trpc } = await import("@/shared/utils/trpc");
const { PortalFmtProvider } = await import("./portal-fmt");
const { useFmt } = await import("@/shared/lib/fmt");
const { clearExpectedPlant, expectPlant } = await import("@/shared/lib/plant-sync");

afterEach(() => clearExpectedPlant());

const me = (id: string, units: ReturnType<typeof screenPrefs>) => ({ company: { id, name: id }, units, timeZone: "Asia/Kolkata", plants: [] });
const KG = me("plant-kg", screenPrefs({}));
const LB = me("plant-lb", screenPrefs({ units: { mass: "lb" } }));

function Screen() {
  const { t } = useT();
  const fmt = useFmt();
  return <p data-testid="total">{t("units.bundlesKg", { bundles: 3, kg: fmt.n("order.weight", 5_000_000, "total") })}</p>;
}

function render(held: typeof KG | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (held) qc.setQueryData(trpc.portal.me.queryOptions().queryKey, held as never);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <PortalFmtProvider>
          <Screen />
        </PortalFmtProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("the portal after a plant switch", () => {
  test("no switch: the plant's screens render as before", () => {
    expect(render(KG)).toContain("5,000.0 kg");
  });
  test("the old plant's me in hand: loading state only, no kg", () => {
    expectPlant(LB.company.id);
    const html = render(KG);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("kg");
  });
  test("portal.me dropped and not yet read again: loading state, not the default words", () => {
    expectPlant(LB.company.id);
    const html = render(null);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("kg");
  });
  test("the new plant's me: its screens, in pounds", () => {
    expectPlant(LB.company.id);
    const html = render(LB);
    expect(html).toContain("11,023.1 lb");
    expect(html).not.toContain("kg");
  });
  test("the provider is keyed on the plant id and the switch expects the plant first", () => {
    expect(readFileSync(join(import.meta.dir, "portal-fmt.tsx"), "utf8")).toContain("key: heldId");
    const shell = readFileSync(join(import.meta.dir, "portal-shell.tsx"), "utf8");
    expect(shell.indexOf("expectPlant(companyId)")).toBeGreaterThan(-1);
    expect(shell.indexOf("expectPlant(companyId)")).toBeLessThan(shell.indexOf("dropTenantQueries(queryClient)"));
  });
});
