/**
 * The Units tab at 320 px (units layer, review fix). The labels of the weight, length, section weight and grouping choices are
 * long, so below the sm breakpoint each is a select that shows the whole label; from sm up it is the segmented control.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { readUnitSettings } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

const { trpc } = await import("@/shared/utils/trpc");
const { UnitsPanel } = await import("./units-tab");

function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, {
    user: { id: "u", name: "A", email: "a@x.in" },
    company: { id: "c", name: "P", role: "owner", settings: { timezone: "Asia/Kolkata" }, modules: {} },
    permissions: [],
  } as never);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <UnitsPanel plant={readUnitSettings({})} timezone="Asia/Kolkata" />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("the four long choices", () => {
  const html = render();
  test("each has a select for narrow screens that carries every full label", () => {
    expect(html.match(/data-testid="units-pick-select"/g)?.length).toBe(4);
    for (const label of ["Kilograms (kg)", "Tonnes (t)", "Pounds (lb)", "Millimetres (mm)", "Feet and inches", "Metres (m)", "International (1,234,567)", "Indian (12,34,567)"]) {
      expect(html).toContain(`>${label}</option>`);
    }
  });
  test("the select is hidden from sm up and the segmented control is hidden below it", () => {
    expect(html.match(/class="relative inline-flex w-full min-w-0 sm:hidden"/g)?.length).toBe(4);
    expect(html.match(/<div class="hidden sm:block">/g)?.length).toBe(4);
  });
  test("the two-option clock keeps the segmented control at every width", () => {
    expect(html).toContain("24 hour");
    expect(html.match(/role="radiogroup"/g)?.length).toBe(5);
  });
});
