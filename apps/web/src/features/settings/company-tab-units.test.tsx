/**
 * The Company tab names the plant's real length choice (units layer, review leftover). A plant on metres reads "Metres (m)"
 * there, never millimetres, and is sent to the Units tab for the length; plants on millimetres or feet and inches keep the
 * two-way switch.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

import { lengthChoiceOf } from "./model";

const { trpc } = await import("@/shared/utils/trpc");
const { CompanyTab } = await import("./company-tab");

type Units = Parameters<typeof screenPrefs>[0];

function render(units: Units, role: "owner" | "viewer", lengthUnit: "mm" | "inch", locale: "en" | "hi" | "gu" = "en") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, {
    user: { id: "u", name: "A", email: "a@x.in" },
    company: { id: "c", name: "Plant", slug: "plant", role, settings: { timezone: "Asia/Kolkata", lengthUnit }, modules: {}, units: screenPrefs(units) },
    permissions: [],
  } as never);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>
        <CompanyTab />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("lengthChoiceOf", () => {
  test("the resolved length choice wins, the legacy key is the fallback", () => {
    expect(lengthChoiceOf(screenPrefs({ units: { length: "m" } }), { lengthUnit: "mm" })).toBe("m");
    expect(lengthChoiceOf(screenPrefs({ units: { length: "ft_in" } }), { lengthUnit: "inch" })).toBe("inch");
    expect(lengthChoiceOf(screenPrefs({}), { lengthUnit: "mm" })).toBe("mm");
    expect(lengthChoiceOf(undefined, { lengthUnit: "inch" })).toBe("inch");
    expect(lengthChoiceOf(undefined, undefined)).toBe("mm");
  });
});

describe("a metres plant on the Company tab", () => {
  test("an owner reads Metres (m) with a pointer to the Units tab, and no mm or feet switch", () => {
    const html = render({ units: { length: "m" } }, "owner", "mm");
    expect(html).toContain("Metres (m)");
    expect(html).toContain("Change the length on the Units tab.");
    expect(html).not.toContain("Millimetres (mm)");
    expect(html).not.toContain("Feet and inches");
  });
  test("a viewer reads Metres (m)", () => {
    const html = render({ units: { length: "m" } }, "viewer", "mm");
    expect(html).toContain("Metres (m)");
    expect(html).not.toContain("Millimetres");
  });
  test("in Hindi and Gujarati the length is metres too", () => {
    expect(render({ units: { length: "m" } }, "viewer", "mm", "hi")).toContain("मीटर (m)");
    expect(render({ units: { length: "m" } }, "viewer", "mm", "gu")).toContain("મીટર (m)");
  });
});

describe("plants on millimetres or feet and inches keep today's Company tab", () => {
  test("millimetres: the two-way switch with mm chosen", () => {
    const html = render({}, "owner", "mm");
    expect(html).toContain("Millimetres (mm)");
    expect(html).toContain("Feet and inches");
    expect(html).not.toContain("Change the length on the Units tab.");
  });
  test("feet and inches: the same switch", () => {
    const html = render({ units: { length: "ft_in" } }, "owner", "inch");
    expect(html).toContain("Millimetres (mm)");
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("Change the length on the Units tab.");
  });
});
