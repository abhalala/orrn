import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Layout guards for any screen, shared by the e2e and visual Playwright
 * projects (one implementation; do not copy it). They catch the production
 * text-clipping family: pages that scroll sideways, text running under a
 * chip, text that overflows its box without an ellipsis, and key values
 * marked `data-no-truncate` (big numbers, weights, codes) that are cut off
 * at all.
 *
 * `collect*` return the issues (for sweeps and the self-check spec);
 * `expect*` fail the test with every issue listed.
 */

export type LayoutIssue = {
  kind: "page-scroll" | "past-viewport" | "overflow-no-ellipsis" | "under-chip" | "truncated-key-value";
  detail: string;
};

/**
 * The page never scrolls sideways, and nothing pokes past the right edge.
 * The global CSS clips sideways overflow on body, which hides the scrollbar
 * but not the cut-off content, so this also checks every visible element's
 * box (except inside a container that scrolls or clips on purpose).
 */
export async function collectHorizontalScrollIssues(page: Page): Promise<LayoutIssue[]> {
  const result = await page.evaluate(() => {
    const vw = window.innerWidth;
    const doc = document.documentElement;
    const clippingAncestor = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body && p !== doc; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== "visible") return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 && !clippingAncestor(el)) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
      }
    }
    return { scrollWidth: doc.scrollWidth, innerWidth: vw, offenders: offenders.slice(0, 10) };
  });
  const issues: LayoutIssue[] = [];
  if (result.scrollWidth > result.innerWidth) {
    issues.push({
      kind: "page-scroll",
      detail: `document scrollWidth ${result.scrollWidth} > innerWidth ${result.innerWidth}`,
    });
  }
  for (const o of result.offenders) issues.push({ kind: "past-viewport", detail: o });
  return issues;
}

/**
 * Text is never cut off or covered:
 * - a key value marked `data-no-truncate` (or anything inside it) must not be
 *   ellipsised, line-clamped or cut by an overflow box: touch users cannot
 *   hover for a title;
 * - an element with its own text whose content is wider than its box must
 *   show an ellipsis (`text-overflow: ellipsis`) or be a deliberate scroller;
 * - no text overlaps a chip or badge next to it.
 */
export async function collectClippedTextIssues(page: Page, scope?: Locator | string): Promise<LayoutIssue[]> {
  const locator = typeof scope === "string" ? page.locator(scope).first() : scope;
  const root = locator ? await locator.elementHandle() : null;
  return page.evaluate((rootEl) => {
    const base = (rootEl as Element | null) ?? document.body;
    const out: { kind: LayoutIssue["kind"]; detail: string }[] = [];
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[${el.getAttribute("data-slot")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const srOnly = (el: Element) => {
      const cs = getComputedStyle(el);
      return cs.clip !== "auto" || cs.clipPath !== "none" || (cs.position === "absolute" && el.getBoundingClientRect().width <= 1);
    };

    // 0. Key values marked `data-no-truncate` show in full.
    for (const el of Array.from(base.querySelectorAll<HTMLElement>("[data-no-truncate]"))) {
      if (!visible(el) || srOnly(el)) continue;
      for (const t of [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))]) {
        if (t !== el && (!visible(t) || srOnly(t))) continue;
        const cs = getComputedStyle(t);
        const clampValue = cs.getPropertyValue("-webkit-line-clamp") || cs.getPropertyValue("line-clamp");
        const clamped = clampValue !== "" && clampValue !== "none";
        const cut = t.scrollWidth > t.clientWidth + 1 && cs.overflowX !== "visible";
        if (cs.textOverflow === "ellipsis" || clamped || cut) {
          const how =
            cs.textOverflow === "ellipsis"
              ? "ellipsised"
              : clamped
                ? "line-clamped"
                : `cut (${t.scrollWidth} > ${t.clientWidth})`;
          out.push({ kind: "truncated-key-value", detail: `key value ${how}: ${describe(t)}` });
          break;
        }
      }
    }

    // 1. Overflowing text without an ellipsis.
    for (const el of Array.from(base.querySelectorAll<HTMLElement>("*"))) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof SVGElement) continue;
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (!ownText || !visible(el) || srOnly(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
      if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis") {
        out.push({
          kind: "overflow-no-ellipsis",
          detail: `overflows without ellipsis: ${describe(el)} (${el.scrollWidth} > ${el.clientWidth})`,
        });
      }
    }

    // 2. Text running under a chip or badge.
    const chips = Array.from(base.querySelectorAll<HTMLElement>("[data-slot='chip'], [data-slot='badge']")).filter(visible);
    for (const chip of chips) {
      const c = chip.getBoundingClientRect();
      const row = chip.parentElement?.parentElement ?? chip.parentElement;
      if (!row) continue;
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || chip.contains(n)) continue;
        const parent = n.parentElement;
        if (!parent || !visible(parent) || srOnly(parent)) continue;
        // What of the text is actually painted: clip its boxes to every
        // ancestor (up to the row) that hides overflow, e.g. a `truncate` span.
        let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
        for (let a: Element | null = parent; a && a !== row.parentElement; a = a.parentElement) {
          const acs = getComputedStyle(a);
          if (acs.overflowX !== "visible" || acs.overflowY !== "visible") {
            const ar = a.getBoundingClientRect();
            clip = {
              left: Math.max(clip.left, ar.left),
              top: Math.max(clip.top, ar.top),
              right: Math.min(clip.right, ar.right),
              bottom: Math.min(clip.bottom, ar.bottom),
            };
          }
        }
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const raw of Array.from(range.getClientRects())) {
          const r = {
            left: Math.max(raw.left, clip.left),
            top: Math.max(raw.top, clip.top),
            right: Math.min(raw.right, clip.right),
            bottom: Math.min(raw.bottom, clip.bottom),
          };
          const overlapX = Math.min(r.right, c.right) - Math.max(r.left, c.left);
          const overlapY = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
          if (overlapX > 1 && overlapY > 1) {
            out.push({ kind: "under-chip", detail: `text under ${describe(chip)}: "${n.textContent.trim().slice(0, 40)}"` });
            break;
          }
        }
      }
    }
    return out.slice(0, 15);
  }, root);
}

function format(issues: LayoutIssue[]): string {
  return issues.map((i) => `[${i.kind}] ${i.detail}`).join("\n");
}

/** Fails when the page scrolls sideways or an element sticks out past the right edge. */
export async function expectNoHorizontalScroll(page: Page) {
  const issues = await collectHorizontalScrollIssues(page);
  expect(issues, `Horizontal overflow on ${page.url()}:\n${format(issues)}`).toEqual([]);
}

/** Fails when text is clipped without an ellipsis, runs under a chip, or a `data-no-truncate` value is cut. */
export async function expectNoClippedText(page: Page, scope?: Locator | string) {
  const issues = await collectClippedTextIssues(page, scope);
  expect(issues, `Clipped text on ${page.url()}:\n${format(issues)}`).toEqual([]);
}

/**
 * A wide table lives in its own focusable scroll region; at the desktop width every column and the totals row must fit.
 * Wait for fonts and layout before measuring (BACKLOG 114), without allowing clipped columns or a percentage tolerance.
 */
export async function expectTableFitsFrame(table: Locator) {
  const frame = table.locator("xpath=ancestor::*[@role='region'][1]");
  await expect(frame).toHaveAttribute("tabindex", "0");
  await table.page().evaluate(async () => {
    await document.fonts.ready;
    const { promise, resolve } = Promise.withResolvers<void>();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    await promise;
  });
  await expect.poll(
    () => frame.evaluate((el) => el.scrollWidth - el.clientWidth),
    { message: "the table needs horizontal scrolling to show all columns" },
  ).toBeLessThanOrEqual(1);
}
