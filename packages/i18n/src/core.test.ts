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

  test("Hindi verbs agree with count 1", () => {
    const { t } = createI18n("hi");
    expect(t("scan.continuous.count", { count: 1 })).toBe("1 जुड़ा");
    expect(t("scan.continuous.count", { count: 5 })).toBe("5 जुड़े");
    expect(t("dispatch.paste.added", { count: 1 })).toBe("1 जुड़ा");
    expect(t("dispatch.paste.already", { count: 1 })).toBe("1 इस dispatch में पहले से है");
    expect(t("dispatch.paste.already", { count: 2 })).toBe("2 इस dispatch में पहले से हैं");
    expect(t("dispatch.paste.notFound", { count: 1 })).toBe("1 नहीं मिला");
    expect(t("dispatch.paste.unavailable", { count: 1 })).toBe("1 उपलब्ध नहीं है");
    expect(t("today.tiles.dispatchHint", { count: 1 })).toBe("1 खुला");
    expect(t("today.tiles.dispatchHint", { count: 3 })).toBe("3 खुले");
    expect(t("today.printProblemsCount", { count: 1 })).toBe("1 लेबल प्रिंट नहीं हुआ");
    expect(t("pack.new.printFailed", { count: 4 })).toBe("4 लेबल प्रिंट नहीं हुए");
    expect(t("settings.data.imported", { count: 1 })).toBe("1 लाइन इम्पोर्ट हो गई");
    expect(t("settings.data.imported", { count: 12 })).toBe("12 लाइन इम्पोर्ट हो गईं");
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

  test("renders a form template as {count} when the variable is missing", () => {
    expect(interpolate("{count} {count:bundle|bundles}")).toBe("{count} {count}");
    expect(interpolate("{count:जुड़ा|जुड़े}", { other: 1 })).toBe("{count}");
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
    expect(listGuides("en")).toHaveLength(11);
    const viewer = listGuides("en", "viewer").map((g) => g.slug);
    expect(viewer).toEqual(["scan-bundle", "printer-trouble"]);
    expect(listGuides("en", "owner")).toHaveLength(11);
  });
});
