import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * WCAG 2.2 AA checks for the public pages (C2 theme). Runs in every project (desktop + mobile,
 * light + dark). Axe fails the run on any serious or critical violation (moderate and minor ones
 * are logged as annotations), and the keyboard, reflow, motion and form checks below cover what
 * axe cannot see: the skip link really moves focus, every control shows a ring that survives its
 * ground, nothing is covered by a fixed bar, text spacing and 320 px reflow do not break the page,
 * and form errors are tied to their field.
 */
const PAGES = [
  { path: "/", name: "landing" },
  { path: "/login", name: "login" },
  { path: "/request-access", name: "request access" },
  { path: "/waitlist", name: "waitlist (redirects to request access)" },
  { path: "/forgot-password", name: "forgot password" },
  { path: "/reset-password?token=test", name: "reset password" },
  { path: "/reset-password", name: "reset password, dead link" },
  { path: "/continue?token=test", name: "continue" },
  { path: "/continue", name: "continue, dead link" },
  { path: "/invite/test-token", name: "invite" },
  { path: "/privacy", name: "privacy" },
  { path: "/terms", name: "terms" },
] as const;

const SITE_TITLE = "ORRN: multi-company ERP for manufactured inventory ops";

test.beforeEach(async ({ page }) => {
  // Static layout so axe sees final colours, not mid-animation opacity.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main h1, main [role=heading][aria-level='1']").first()).toBeVisible();
}

for (const { path, name } of PAGES) {
  test(`${name} has no serious or critical axe violations`, async ({ page }, testInfo) => {
    await open(page, path);
    const theme = testInfo.project.name.includes("light") ? "light" : "dark";
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      // Dev-only overlays (TanStack/React Query devtools) are not product UI.
      .exclude(".TanStackRouterDevtools")
      .exclude(".tsqd-parent-container")
      .exclude("[class*='tsqd-']")
      .analyze();

    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    for (const v of results.violations.filter((x) => x.impact === "moderate" || x.impact === "minor")) {
      testInfo.annotations.push({
        type: `axe-${v.impact}`,
        description: `${path}: ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`,
      });
    }
    const summary = blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}

test.describe("page titles (2.4.2)", () => {
  for (const { path, name } of PAGES) {
    test(`${name} has its own title`, async ({ page }) => {
      await open(page, path);
      // The title is set in an effect after first paint: poll instead of reading it once.
      await expect(page).not.toHaveTitle(SITE_TITLE);
      await expect(page).toHaveTitle(/\S/);
    });
  }
});

test.describe("landing page keyboard", () => {
  test("skip link is the first stop and moves focus into main", async ({ page }) => {
    await open(page, "/");
    await page.keyboard.press("Tab");
    const skip = page.locator('a[href="#main"]');
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
    // The next Tab continues inside the page content, not from the header again.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
  });

  test("every control shows a two-tone focus ring and is never covered", async ({ page }) => {
    await open(page, "/");
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const points = [
          [box.left + box.width / 2, box.top + box.height / 2],
          [box.left + 3, box.top + 3],
          [box.right - 3, box.top + 3],
          [box.left + 3, box.bottom - 3],
          [box.right - 3, box.bottom - 3],
        ] as const;
        const reachable = points.some(([x, y]) => {
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
          const hit = document.elementFromPoint(x, y);
          return hit === el || el.contains(hit);
        });
        const shadowColour = cs.boxShadow.match(/rgba?\([^)]+\)/)?.[0] ?? "";
        return {
          label: (el.getAttribute("aria-label") ?? el.textContent ?? el.id).trim().slice(0, 40),
          key: `${el.tagName}|${el.getAttribute("href")}|${el.textContent?.slice(0, 20)}|${Math.round(box.left)}|${Math.round(box.top + scrollY)}`,
          isMain: el.tagName === "MAIN",
          outlineWidth: parseFloat(cs.outlineWidth),
          outlineStyle: cs.outlineStyle,
          outlineColour: cs.outlineColor,
          shadowColour,
          reachable,
        };
      });
      if (!stop) break;
      if (seen.has(stop.key)) break;
      seen.add(stop.key);
      expect(stop.reachable, `"${stop.label}" is covered by a fixed bar when focused`).toBe(true);
      if (stop.isMain) continue;
      expect(stop.outlineStyle, `"${stop.label}" has no outline`).not.toBe("none");
      expect(stop.outlineWidth, `"${stop.label}" outline is thinner than 2px`).toBeGreaterThanOrEqual(2);
      expect(stop.shadowColour, `"${stop.label}" has no second ring tone`).not.toBe("");
      expect(stop.shadowColour, `"${stop.label}" ring tones are the same colour`).not.toBe(stop.outlineColour);
    }
    // Skip link, header, CTAs, slider, tabs, board links, footer and credits.
    expect(seen.size).toBeGreaterThan(20);
  });

  test("office tabs: one tab stop, arrows, Home and End move and select, panel is focusable", async ({ page }) => {
    await open(page, "/");
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
    expect(await tabs.evaluateAll((all) => all.filter((t) => (t as HTMLElement).tabIndex === 0).length)).toBe(1);

    await page.getByRole("tab", { selected: true }).focus();
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tabs.first()).toBeFocused();

    // The panel sits before the tab list in the page, so a Tab from the slider reaches it, then the tab.
    await page.getByRole("slider").focus();
    await page.keyboard.press("Tab");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tab", { selected: true })).toBeFocused();
    // The sample is read out, not hidden: the packing list is a real table.
    await page.getByRole("tab").nth(1).click();
    await expect(panel.getByRole("table")).toBeVisible();
    await expect(panel.locator("th[scope=col]")).toHaveCount(3);
    expect(await panel.locator("table caption").count()).toBe(1);
  });

  test("audit slider has a name and a value", async ({ page }) => {
    await open(page, "/");
    const slider = page.getByRole("slider");
    await expect(slider).toHaveCount(1);
    await expect(slider).toHaveAccessibleName(/\S/);
    await slider.focus();
    const before = await slider.inputValue();
    await page.keyboard.press("ArrowRight");
    expect(await slider.inputValue()).not.toBe(before);
  });

  test("the page has no mobile menu to trap focus: header controls stay reachable and in view", async ({ page }) => {
    await open(page, "/");
    const header = page.locator("header.marketing-header");
    const controls = [
      header.getByRole("link", { name: "Sign in" }),
      header.getByRole("radio", { name: "English" }),
      header.getByRole("link", { name: "Request access" }),
    ];
    for (const control of controls) {
      await control.focus();
      await expect(control).toBeFocused();
      await expect(control).toBeInViewport();
    }
    // The language switch is one radio group: a name, one checked radio.
    await expect(header.getByRole("radiogroup")).toHaveAccessibleName(/\S/);
    await expect(header.getByRole("radio", { checked: true })).toHaveCount(1);
  });

  test("with reduced motion nothing waits to be revealed", async ({ page }) => {
    await open(page, "/");
    const hidden = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("[data-reveal] > *, .marketing-card *")) {
        const cs = getComputedStyle(el);
        if (cs.opacity !== "1" && cs.display !== "none") bad.push(`${el.tagName}.${el.className}`);
        if (cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0) bad.push(`animating ${el.tagName}.${el.className}`);
      }
      return bad.slice(0, 5);
    });
    expect(hidden).toEqual([]);
  });

  test("images: informative ones have alt, decorative ones are hidden from readers", async ({ page }) => {
    await open(page, "/");
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .filter((img) => !img.hasAttribute("alt"))
        .map((img) => img.src.slice(-40)),
    );
    expect(bad).toEqual([]);
    // The yard photograph beside the closing tile is decoration.
    expect(await page.locator("img[alt='']").count()).toBeGreaterThan(0);
  });
});

test.describe("reflow, zoom and text spacing", () => {
  const SPACING = `
    * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
    p { margin-bottom: 2em !important; }
  `;

  for (const { path, name } of PAGES) {
    test(`${name} reflows at 320 px (400% zoom) with no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await open(page, path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  for (const path of ["/", "/login", "/request-access", "/privacy"]) {
    test(`${path} survives the text spacing override (1.4.12)`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await open(page, path);
      await page.addStyleTag({ content: SPACING });
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => {
        const clipped: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("a, button, label, h1, h2, h3, p, li, th, td")) {
          const cs = getComputedStyle(el);
          // The skip link is clipped on purpose until it takes focus.
          if (cs.display === "none" || el.closest("[aria-hidden='true']") || el.matches(".sr-only")) continue;
          const hides = cs.overflow !== "visible" && cs.overflow !== "clip";
          if (hides && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)) {
            clipped.push(`${el.tagName}.${el.className.toString().slice(0, 30)}`);
          }
        }
        return { clipped: clipped.slice(0, 5), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(result.clipped).toEqual([]);
      expect(result.overflow).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("front-door forms", () => {
  test("login: empty submit names the problem on the field and moves focus to it", async ({ page }) => {
    await open(page, "/login");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const email = page.getByLabel(/email/i).first();
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    const describedBy = await email.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const text = await page.evaluate((ids) => ids?.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" "), describedBy);
    expect(text?.trim().length).toBeGreaterThan(0);
    await expect(email).toHaveAttribute("autocomplete", "username");
  });

  test("login: password field has a stateful show/hide button and the right autocomplete", async ({ page }) => {
    await open(page, "/login");
    const password = page.locator('input[name="password"]');
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await expect(password).toHaveAttribute("type", "password");
    const toggle = page.locator('input[name="password"] ~ button');
    await expect(toggle).toHaveAccessibleName(/\S/);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const box = await toggle.boundingBox();
    expect(box && box.width >= 24 && box.height >= 24).toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("type", "text");
    await expect(toggle).toBeFocused();
  });

  test("request access: errors are tied to their fields, first bad field gets focus", async ({ page }) => {
    await open(page, "/request-access");
    await page.locator("form button[type=submit]").click();
    const invalid = page.locator("form [aria-invalid='true']");
    await expect(invalid).toHaveCount(3);
    await expect(invalid.first()).toBeFocused();
    for (const el of await invalid.all()) {
      const describedBy = await el.getAttribute("aria-describedby");
      expect(describedBy, "an invalid field points at its error").toBeTruthy();
    }
    await expect(page.locator('input[autocomplete="organization"]')).toHaveCount(1);
    await expect(page.locator('input[autocomplete="name"]')).toHaveCount(1);
    await expect(page.locator('input[autocomplete="email"]')).toHaveCount(1);
  });

  test("forgot password: invalid address is announced on the field", async ({ page }) => {
    await open(page, "/forgot-password");
    await page.getByLabel(/email/i).fill("not-an-address");
    await page.locator("form button[type=submit]").click();
    const email = page.getByLabel(/email/i);
    await expect(email).toHaveAttribute("aria-invalid", "true");
    expect(await email.getAttribute("aria-describedby")).toBeTruthy();
  });

  test("reset password: both toggles are buttons with names, new-password autocomplete", async ({ page }) => {
    await open(page, "/reset-password?token=test");
    await expect(page.locator('input[autocomplete="new-password"]')).toHaveCount(2);
    const toggles = page.locator("form button[aria-pressed]");
    await expect(toggles).toHaveCount(2);
    for (const toggle of await toggles.all()) await expect(toggle).toHaveAccessibleName(/\S/);
  });

  test("front-door pages open with a skip link that moves focus into main", async ({ page }) => {
    for (const path of ["/login", "/request-access", "/forgot-password"]) {
      await open(page, path);
      await page.keyboard.press("Tab");
      const skip = page.locator('a[href="#main"]');
      await expect(skip).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("main#main")).toBeFocused();
    }
  });
});
