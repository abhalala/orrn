import { expect, test } from "@playwright/test";

import { collectClippedTextIssues, collectHorizontalScrollIssues } from "../helpers/layout-guards";

/**
 * Self-check for the shared layout guards (`tests/helpers/layout-guards.ts`):
 * plant the patterns from the production clipping bug (Godseye overview,
 * hotfix b13ed25..95ef118) on a public page and make sure each is reported,
 * and that the same content laid out correctly passes. Ported from the
 * hotfix's visual-project self-check when the two guard helpers were merged.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await expect(page.locator("h1").first()).toBeVisible();
});

test("guards catch the clipping bug patterns", async ({ page }) => {
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "guard-fixture";
    host.innerHTML = `
      <div style="display:flex;width:220px;gap:8px;align-items:flex-start">
        <div style="min-width:0;white-space:nowrap">Shree Venkateshwara Aluminium Extrusions</div>
        <span data-slot="badge" style="white-space:nowrap">Active</span>
      </div>
      <div style="width:120px;overflow:hidden;white-space:nowrap">A label that is cut off without an ellipsis</div>
      <p data-no-truncate style="width:40px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">18,940.5 kg</p>
      <p data-no-truncate style="width:200px;margin:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden">1,23,456.7 kg</p>
      <div style="width:3000px;height:4px"></div>
    `;
    document.body.insertBefore(host, document.body.firstChild);
  });

  const text = await collectClippedTextIssues(page, "#guard-fixture");
  const kinds = new Set(text.map((i) => i.kind));
  expect([...kinds].sort()).toEqual(
    expect.arrayContaining(["overflow-no-ellipsis", "truncated-key-value", "under-chip"]),
  );
  // Both marked key values are caught: the ellipsised one and the clamped one.
  const keyValues = text.filter((i) => i.kind === "truncated-key-value").map((i) => i.detail);
  expect(keyValues.some((d) => d.includes("ellipsised") && d.includes("18,940.5"))).toBe(true);
  expect(keyValues.some((d) => d.includes("line-clamped") && d.includes("1,23,456.7"))).toBe(true);

  const scroll = await collectHorizontalScrollIssues(page);
  expect(scroll.some((i) => i.kind === "past-viewport" || i.kind === "page-scroll")).toBe(true);
});

test("guards pass the same content laid out properly", async ({ page }) => {
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "guard-fixture";
    host.innerHTML = `
      <div style="display:flex;width:220px;gap:8px;align-items:center">
        <span style="display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Shree Venkateshwara Aluminium Extrusions</span>
        <span data-slot="badge" style="white-space:nowrap;flex-shrink:0">Active</span>
      </div>
      <div style="width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">A label that is cut off with an ellipsis</div>
      <p data-no-truncate style="width:120px;margin:0;overflow-wrap:break-word">18,940.5 kg</p>
    `;
    document.body.insertBefore(host, document.body.firstChild);
  });

  expect(await collectClippedTextIssues(page, "#guard-fixture")).toEqual([]);
  expect(await collectHorizontalScrollIssues(page)).toEqual([]);
});
