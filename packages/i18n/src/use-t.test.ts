import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { I18nProvider, useT, type I18nContextValue } from "./use-t";

/** Renders `useT()` once and hands back what it returned. */
function capture(wrap: (child: ReturnType<typeof createElement>) => ReturnType<typeof createElement>) {
  let seen: I18nContextValue | undefined;
  function Probe() {
    seen = useT();
    return createElement("span", null, seen.t("nav.stock"));
  }
  const html = renderToString(wrap(createElement(Probe)));
  if (!seen) throw new Error("Probe did not render");
  return { html, value: seen };
}

describe("useT", () => {
  test("outside a provider it falls back to English", () => {
    const { html, value } = capture((child) => child);
    expect(value.locale).toBe("en");
    expect(html).toContain("Stock");
    expect(() => value.setLocale("hi")).not.toThrow();
  });

  test("inside a provider it uses the provider's locale", () => {
    const { html, value } = capture((child) => createElement(I18nProvider, { locale: "hi" }, child));
    expect(value.locale).toBe("hi");
    expect(html).toContain("स्टॉक");
  });

  test("setLocale calls onLocaleChange with the new locale", () => {
    const onLocaleChange = mock((_locale: string) => {});
    const { value } = capture((child) => createElement(I18nProvider, { locale: "en", onLocaleChange }, child));
    value.setLocale("hi");
    expect(onLocaleChange).toHaveBeenCalledTimes(1);
    expect(onLocaleChange).toHaveBeenCalledWith("hi");
  });
});
