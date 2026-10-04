import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { MARKETING_BUDGET_GZIP, MARKETING_MARKER, measureRoute } from "../../scripts/route-budget";
import { collectClippedTextIssues, collectHorizontalScrollIssues } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";

/**
 * Marketing page `/` (C2 Task 18). Needs the local stack for the signed-in
 * redirect; everything else is public.
 */

const HEADLINE = "Every bundle, accounted for.";

const HEADLINE_HI = "हर bundle का पूरा हिसाब।";
const TITLE = "orrn: every bundle, accounted for";
const TITLE_HI = "orrn: हर bundle का पूरा हिसाब";
const SUB_HI = "orrn हर bundle को पैकिंग से dispatch तक ट्रैक करता है, ताकि फ़्लोर और ऑफ़िस एक ही स्टॉक देखें।";

/** Every animated part: the hero picture and the flow demos (rows, pills, the stock figure). */
const MOTION_PARTS = "[data-anim], [data-demo-row], [data-demo-pop], [data-demo-stat], [data-demo-count]";
const FLOW_PARTS = MOTION_PARTS.split(", ")
  .map((s) => `#flow ${s}`)
  .join(", ");

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
    localStorage.setItem("orrn.theme", t);
  }, theme);
}

/** Opens `/` in Hindi (the stored choice the root reads on load). */
async function openInHindi(page: Page) {
  await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE_HI);
}

/**
 * Parts matching `selector` that are not in their final state: opacity below
 * 1, any transform other than identity, or a count short of its number. Empty
 * when everything has settled.
 */
function unsettled(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const name = (el: HTMLElement) =>
      [
        el.closest<HTMLElement>("[data-flow-step]")?.dataset.flowStep,
        Object.entries(el.dataset)
          .map(([k, v]) => (v ? `${k}=${v}` : k))
          .join(" "),
        (el.textContent ?? "").trim().slice(0, 24),
      ]
        .filter(Boolean)
        .join(" | ");
    return Array.from(document.querySelectorAll<HTMLElement>(sel)).flatMap((el) => {
      const cs = getComputedStyle(el);
      const issues: string[] = [];
      if (cs.opacity !== "1") issues.push(`opacity ${cs.opacity}`);
      if (cs.transform !== "none" && !new DOMMatrixReadOnly(cs.transform).isIdentity) {
        issues.push(`transform ${cs.transform}`);
      }
      if (el.dataset.demoCount !== undefined && (el.textContent ?? "").trim() !== el.dataset.demoCount) {
        issues.push(`count ${el.textContent}`);
      }
      return issues.length ? [`${name(el)}: ${issues.join(", ")}`] : [];
    });
  }, selector);
}

/** Waits two frames so IntersectionObserver sees the new scroll position. */
function settleFrames(page: Page) {
  return page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

type Box = { left: number; right: number; top: number; bottom: number };

function boxesOf(page: Page, selector: string): Promise<Box[]> {
  return page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
}

test.describe("marketing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("orrn.locale"));
  });

  test("headline, one h1, and both CTAs go to request access and sign in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
    await expect(page.locator("h1")).toHaveCount(1);

    const hero = page.locator("[data-marketing-hero]");
    await expect(hero.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
    await expect(hero.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");

    const closing = page.locator("[data-marketing-cta]");
    await expect(closing.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
    await expect(closing.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("Request access opens the request form, Sign in opens login", async ({ page }) => {
    await page.goto("/");
    await page.locator("[data-marketing-hero]").getByRole("link", { name: "Request access" }).click();
    await expect(page).toHaveURL(/\/request-access$/);
    await page.goto("/");
    await page.locator("[data-marketing-hero]").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("landmarks and section headings are in order", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    const h2s = await page.locator("main h2").allTextContents();
    expect(h2s).toEqual([
      "Pack. Stock. Dispatch.",
      "Built for the floor",
      "For the office",
      "Your data stays yours",
      "Try it on your floor",
    ]);
    // The flow is an ordered list of three steps; WebKit drops list semantics from unstyled lists without the role.
    const flowList = page.locator("#flow ol");
    await expect(flowList).toHaveAttribute("role", "list");
    await expect(flowList.getByRole("listitem")).toHaveCount(3);
  });

  test("demo visuals are hidden from screen readers and carry a visible Demo data label", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const visuals = page.locator("[data-demo-visual]");
    const count = await visuals.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      const visual = visuals.nth(i);
      await expect(visual).toHaveAttribute("aria-hidden", "true");
      await expect(visual.getByText("Demo data", { exact: true })).toBeVisible();
    }
  });

  test("one tap switches the page to Hindi and sets <html lang>", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE_HI);
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.getByRole("banner").getByRole("radio", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
  });

  test("the tab title and description follow the language toggle", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(TITLE);
    await page.getByRole("banner").getByRole("radio", { name: "हिंदी" }).click();
    await expect(page).toHaveTitle(TITLE_HI);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", SUB_HI);
    await page.getByRole("banner").getByRole("radio", { name: "English" }).click();
    await expect(page).toHaveTitle(TITLE);
  });

  test("Hindi headings get room for Devanagari marks: leading 1.2 or more, no negative tracking", async ({ page }) => {
    await openInHindi(page);
    const tight = await page.locator("main h1, main h2, main h3").evaluateAll((els) =>
      els
        .filter((el) => {
          const cs = getComputedStyle(el);
          const size = parseFloat(cs.fontSize);
          const leading = cs.lineHeight === "normal" ? size * 1.2 : parseFloat(cs.lineHeight);
          const tracking = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing);
          return leading < size * 1.2 - 0.5 || tracking < 0;
        })
        .map((el) => `${el.tagName} ${el.textContent}: ${getComputedStyle(el).lineHeight} / ${getComputedStyle(el).letterSpacing}`),
    );
    expect(tight).toEqual([]);
  });

  test("reduced motion shows the final state with nothing hidden or moved", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The flow demos are covered too, not only the hero picture.
    expect(await page.locator(FLOW_PARTS).count()).toBeGreaterThan(10);
    expect(await unsettled(page, MOTION_PARTS)).toEqual([]);
  });

  test("with motion, the hero settles into the same final state", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The sequence runs about 2.5 s after the picture is in view; poll instead
    // of a fixed wait so a busy machine does not read it mid-flight. Opacity
    // and transform: a tween stuck at y 32 or scale 0.94 is not settled.
    await expect.poll(() => unsettled(page, "[data-marketing-hero] [data-anim]"), { timeout: 10_000 }).toEqual([]);
  });

  // Wide screens play one sequence across the row, phones each block as it
  // arrives: two code paths, so both widths. The demos start hidden (from
  // tweens), so this fails if a timeline is built but never played.
  for (const width of [390, 1280]) {
    test(`the flow demos play to their final state when scrolled into view at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const steps = page.locator("#flow [data-flow-step]");
      await expect(steps).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        await steps.nth(i).evaluate((el) => el.scrollIntoView({ block: "center" }));
        await settleFrames(page);
      }
      await expect(page.locator("#flow")).toHaveAttribute("data-played", "true", { timeout: 5000 });
      await expect.poll(() => unsettled(page, FLOW_PARTS), { timeout: 10_000 }).toEqual([]);
    });
  }

  test("the stock figure fades in with its unit: the unit never shows alone mid-sequence", async ({ page }) => {
    // A controlled clock steps the GSAP ticker (requestAnimationFrame + Date) frame by frame.
    await page.clock.install();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
    await page.locator("#flow [data-flow-list]").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(page.locator("#flow")).toHaveAttribute("data-played", "true", { timeout: 5000 });

    const read = () =>
      page.evaluate(() => {
        const shown = (el: Element | null) => {
          let o = 1;
          for (let n = el; n && n !== document.body; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
          return Math.round(o * 1000) / 1000;
        };
        const figure = document.querySelector<HTMLElement>('#flow [data-flow-step="stock"] [data-demo-count]');
        const unit = figure?.nextElementSibling ?? null;
        return { figure: shown(figure), unit: shown(unit), text: (figure?.textContent ?? "").trim() };
      });
    const lone: string[] = [];
    let last = await read();
    for (let i = 0; i < 80; i++) {
      await page.clock.runFor(40);
      last = await read();
      if (last.unit > 0.05 && last.figure < last.unit - 0.001) lone.push(`${i * 40} ms: ${JSON.stringify(last)}`);
    }
    expect(lone).toEqual([]);
    expect(last).toEqual({ figure: 1, unit: 1, text: "412" });
  });

  for (const width of [375, 390, 820, 1280]) {
    test(`no sideways scroll or clipped text at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await collectHorizontalScrollIssues(page)).toEqual([]);
      expect(await collectClippedTextIssues(page)).toEqual([]);
    });
  }

  // The collage is fixed-size pieces placed absolutely; on narrow phones the
  // stock tiles and the printed chip must not land on the scanned label or the
  // scan result.
  for (const [locale, width] of [
    ["en", 320],
    ["en", 360],
    ["en", 375],
    ["en", 390],
    ["hi", 320],
    ["hi", 360],
  ] as const) {
    test(`the hero picture keeps its label and result uncovered at ${width}px (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (locale === "hi") await openInHindi(page);
      else await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const covered = await page.evaluate(() => {
        const textBox = (el: Element) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect();
        };
        const texts = Array.from(document.querySelectorAll("[data-marketing-hero] [data-collage-text]"));
        const covers = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-marketing-hero] [data-anim^="hero-tile"], [data-marketing-hero] [data-anim="hero-printed"]',
          ),
        );
        const hits: string[] = [];
        for (const cover of covers) {
          const a = cover.getBoundingClientRect();
          for (const text of texts) {
            const b = textBox(text);
            const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
            if (overlap) hits.push(`${cover.dataset.anim} covers "${(text.textContent ?? "").trim()}"`);
          }
        }
        return { hits, texts: texts.length };
      });
      expect(covered.texts).toBeGreaterThanOrEqual(4);
      expect(covered.hits).toEqual([]);
    });
  }

  test("on tablets the stacked hero picture and the floor card sit right, under left-aligned text", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const edges = await page.evaluate(() => {
      const contentRight = (section: Element) => {
        const r = section.getBoundingClientRect();
        return r.right - parseFloat(getComputedStyle(section).paddingRight);
      };
      const hero = document.querySelector("[data-marketing-hero] .orrn-section")!;
      const heroPicture = document.querySelector("[data-marketing-hero] [data-demo-visual] > div")!;
      const floor = document.querySelector("#floor")!;
      const floorCard = floor.querySelector("[data-demo-visual]")!;
      return {
        hero: Math.round(contentRight(hero) - heroPicture.getBoundingClientRect().right),
        floor: Math.round(contentRight(floor) - floorCard.getBoundingClientRect().right),
      };
    });
    expect(edges).toEqual({ hero: 0, floor: 0 });
  });

  for (const width of [820, 1280]) {
    test(`each flow demo sits right under its own text at ${width}px (no stretched gap)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const gaps = await page.locator("#flow [data-flow-step]").evaluateAll((steps) =>
        steps.map((step) => {
          const text = step.querySelector(":scope > p")!.getBoundingClientRect();
          const demo = step.querySelector("[data-demo-visual]")!.getBoundingClientRect();
          return Math.round(demo.top - text.bottom);
        }),
      );
      expect(gaps).toEqual([16, 16, 16]);
    });
  }

  test("footer links sit at least 8 px apart", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const boxes = await boxesOf(page, "footer nav a");
    expect(boxes.length).toBe(2);
    const gaps = boxes.slice(1).map((b, i) => {
      const a = boxes[i]!;
      const sameRow = a.top < b.bottom && b.top < a.bottom;
      return Math.round(sameRow ? b.left - a.right : b.top - a.bottom);
    });
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(8);
  });

  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      test(`no serious or critical axe violations, ${theme} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
        await page.goto("/");
        await setTheme(page, theme);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        const blocking = results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  }

  test("keyboard: the skip link jumps past the header to the hero actions", async ({ page }) => {
    await page.goto("/");
    // The page renders after the route's session check: wait for it before tabbing.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-marketing-hero]").getByRole("link", { name: "Request access" })).toBeFocused();
  });
});

test.describe("session check", () => {
  test("an owner opening / lands on /today", async ({ page }) => {
    await signInViaApi(page, "owner");
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/);
  });

  test("a slow session check does not hold the page: it renders signed out after a short wait", async ({ page }) => {
    // auth.me hangs for 20 s; the page must not wait for it.
    await page.route("**/trpc/auth.me**", async (route) => {
      await new Promise((r) => setTimeout(r, 20_000));
      await route.abort().catch(() => {});
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE, { timeout: 10_000 });
  });

  test("a signed-in owner still lands on /today when the session check answers late", async ({ page }) => {
    await signInViaApi(page, "owner");
    let delayed = false;
    await page.route("**/trpc/auth.me**", async (route) => {
      // Only the first check is slow (past the page's wait); later ones pass straight through.
      if (!delayed) {
        delayed = true;
        await new Promise((r) => setTimeout(r, 3500));
      }
      await route.continue().catch(() => {});
    });
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 });
  });
});

test.describe("JS budget", () => {
  const dist = fileURLToPath(new URL("../../dist", import.meta.url));

  // Report only: it measures whatever dist is on disk (possibly another
  // commit's build). The gate is `bun run build` (scripts/check-route-budget.ts),
  // which measures the build it just made and fails over budget.
  test("report: / downloads under 250 kB of JS gzip in the dist on disk", () => {
    test.skip(!existsSync(`${dist}/index.html`), "no build output: run `bun run build` in apps/web first");
    const result = measureRoute(dist, MARKETING_MARKER);
    test.info().annotations.push({ type: "route-budget", description: `${(result.gzip / 1000).toFixed(1)} kB gzip` });
    expect(result.routeChunks.length, "marketing route chunk not found by its marker").toBeGreaterThan(0);
    expect(result.gzip).toBeLessThan(MARKETING_BUDGET_GZIP);
  });
});
