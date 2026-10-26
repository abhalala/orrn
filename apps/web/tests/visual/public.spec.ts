import { test, expect } from "@playwright/test";

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  // The app follows the system theme by default; the projects already emulate
  // it, and this pins the next-themes choice (storage key "orrn.theme") too.
  await page.evaluate((t) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
    localStorage.setItem("orrn.theme", t);
  }, theme);
}

test.beforeEach(async ({ page }, testInfo) => {
  // Reduced motion keeps the material illustration static for deterministic screenshots.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const theme = testInfo.project.name.includes("light") ? "light" : "dark";
  await page.goto("/");
  await setTheme(page, theme);
});

test.describe("public marketing", () => {
  test("landing page layout", async ({ page }) => {
    // Two page loads plus a ~4-6k px full-page capture with stability shots:
    // the default 30 s runs out on a busy machine before any comparison fails.
    test.slow();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // A long page: on touch projects the first full-page capture can still
    // carry the coarse-pointer control heights (Playwright resizes the page to
    // capture it), so give the stability check room for a third shot under load.
    await expect(page).toHaveScreenshot("landing.png", { fullPage: true, timeout: 20_000 });
  });
});

test.describe("public auth", () => {
  test("login page layout", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page).toHaveScreenshot("login.png", { fullPage: true });
  });

  test("request access page layout", async ({ page }) => {
    await page.goto("/request-access");
    await expect(page.getByRole("heading", { level: 1, name: "Request access" })).toBeVisible();
    await expect(page).toHaveScreenshot("request-access.png", { fullPage: true });
  });
});

test.describe("mobile shell", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("login fits viewport without horizontal scroll", async ({ page }) => {
    await page.goto("/login");
    // Poll: third-party portals (toaster) can transiently overflow while
    // their styles inject during mount.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  });
});
