import { test, expect } from "@playwright/test";

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
    localStorage.setItem("theme", t);
  }, theme);
}

test.beforeEach(async ({ page }, testInfo) => {
  // Marketing page is GSAP/Three.js animated; reduced motion swaps in static
  // fallbacks so full-page screenshots are deterministic.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const theme = testInfo.project.name.includes("light") ? "light" : "dark";
  await page.goto("/");
  await setTheme(page, theme);
});

test.describe("public marketing", () => {
  test("landing page layout", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("ORRN", { exact: true }).first()).toBeVisible();
    await expect(page).toHaveScreenshot("landing.png", { fullPage: true });
  });
});

test.describe("public auth", () => {
  test("login page layout", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
    await expect(page).toHaveScreenshot("login.png", { fullPage: true });
  });

  test("waitlist page layout", async ({ page }) => {
    await page.goto("/waitlist");
    await expect(page.getByText("Request ORRN Access")).toBeVisible();
    await expect(page).toHaveScreenshot("waitlist.png", { fullPage: true });
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
