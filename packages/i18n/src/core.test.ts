import { describe, expect, test } from "bun:test";
import { createI18n, interpolate, isLocale } from "./core";
import { getGuide, listGuides } from "./guides";

describe("createI18n", () => {
  test("looks up dotted keys per locale", () => {
    expect(createI18n("en").t("status.bundle.available")).toBe("In stock");
    expect(createI18n("hi").t("status.bundle.available")).toBe("स्टॉक में");
  });

  test("fills variables", () => {
    expect(createI18n("en").t("auth.invite.title", { company: "Fourcubes" })).toBe("Join Fourcubes");
  });

  test("picks the singular or plural word from count", () => {
    const { t } = createI18n("en");
    expect(t("units.bundles", { count: 1 })).toBe("1 bundle");
    expect(t("units.bundles", { count: 0 })).toBe("0 bundles");
    expect(t("units.bundlesKg", { bundles: 157, kg: "7,856.95" })).toBe("157 bundles · 7,856.95 kg");
    expect(createI18n("hi").t("units.bundles", { count: 3 })).toBe("3 bundle");
  });

  test("falls back to the key when nothing matches", () => {
    const { t } = createI18n("hi");
    expect(t("no.such.key" as never)).toBe("no.such.key");
  });
});

describe("interpolate", () => {
  test("leaves unknown variables visible", () => {
    expect(interpolate("Hello {name}", {})).toBe("Hello {name}");
    expect(interpolate("Hello {name}")).toBe("Hello {name}");
  });
});

describe("isLocale", () => {
  test("accepts only en and hi", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("hi")).toBe(true);
    expect(isLocale("gu")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("guides", () => {
  test("getGuide returns the locale's guide", () => {
    expect(getGuide("pack-session", "en").title).toBe("Pack a session and print labels");
    expect(getGuide("pack-session", "hi").slug).toBe("pack-session");
  });

  test("listGuides filters by role", () => {
    expect(listGuides("en")).toHaveLength(10);
    const viewer = listGuides("en", "viewer").map((g) => g.slug);
    expect(viewer).toEqual(["scan-bundle", "printer-trouble"]);
    expect(listGuides("en", "owner")).toHaveLength(10);
  });
});
