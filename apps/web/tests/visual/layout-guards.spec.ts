import { expect, test } from "@playwright/test";

import { collectClippedTextIssues, collectHorizontalScrollIssues } from "./layout-guards";

/**
 * Self-check for the layout guards: plant the exact patterns from the
 * Godseye clipping bug on a public page and make sure each one is reported,
 * and that the same content laid out correctly passes.
 */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
});

test("guards catch the clipping bug patterns", async ({ page }) => {
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "guard-fixture";
    host.innerHTML = `
      <div style="display:flex;width:220px;gap:8px;align-items:flex-start">
        <div style="min-width:0"><a href="#" class="truncate">Shree Venkateshwara Aluminium Extrusions</a></div>
        <span data-slot="badge" style="white-space:nowrap">Active</span>
      </div>
      <p style="width:90px;margin:0;font-size:12px">fourcubes-industry-llp-4210094c</p>
      <p style="width:34px;margin:0;font-size:13px">Oct 6, 2026</p>
      <div style="width:120px;overflow:hidden;white-space:nowrap"><span>A label that is cut off without an ellipsis</span></div>
      <div style="width:3000px;height:4px"></div>
    `;
    document.body.insertBefore(host, document.body.firstChild);
  });

  const text = await collectClippedTextIssues(page, "#guard-fixture");
  const kinds = new Set(text.map((i) => i.kind));
  expect([...kinds].sort()).toEqual(expect.arrayContaining(["clipped", "squeezed", "token-wrap", "under-chip"]));

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
      <p style="width:120px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace">fourcubes-industry-llp-4210094c</p>
      <p style="width:200px;margin:0">Oct 6, 2026</p>
    `;
    document.body.insertBefore(host, document.body.firstChild);
  });

  expect(await collectClippedTextIssues(page, "#guard-fixture")).toEqual([]);
});
