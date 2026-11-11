/**
 * The customer screens write kg totals through the plant formatter (units layer, review fix): a plant on pounds reads converted
 * figures with lb beside them, an international plant reads 1,234,567 not 12,34,567, and a plant that changed nothing reads today's text.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

const { FmtProvider } = await import("@/shared/lib/fmt");
const { OpenOrders } = await import("./customers.$id");

const ORDERS = { orderedG: 5_000_000, dispatchedG: 1_234_567_000, bakiG: 0, lines: 3 };
const render = (prefs: ReturnType<typeof screenPrefs> | undefined) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider locale="en">
        <FmtProvider prefs={prefs} timeZone="Asia/Kolkata">
          <OpenOrders orders={ORDERS} />
        </FmtProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

describe("customer order book cells", () => {
  test("5,000 kg on a pound plant reads 11,023.1 lb", () => {
    const html = render(screenPrefs({ units: { mass: "lb" } }));
    expect(html).toContain("11,023.1 lb");
    expect(html).not.toContain("5,000.0 lb");
  });
  test("an international plant groups in thousands", () => {
    const html = render(screenPrefs({ number: { grouping: "international" } }));
    expect(html).toContain("1,234,567.0 kg");
    expect(html).not.toContain("12,34,567");
  });
  test("a plant that changed nothing reads today's text", () => {
    const html = render(undefined);
    expect(html).toContain("5,000.0 kg");
    expect(html).toContain("12,34,567.0 kg");
  });
});

describe("the other customer figures carry no hand-written kg formatter", () => {
  const read = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
  for (const f of ["customers.$id.tsx", "customers.index.tsx"]) {
    test(`${f} writes weights through the plant formatter`, () => {
      const src = read(f);
      expect(src).not.toContain("formatKgTotal");
      expect(src).toContain("kgGrouped1(fmt,");
    });
  }
});
