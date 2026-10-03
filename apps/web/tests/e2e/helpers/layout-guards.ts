import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Layout guards for any screen. They catch the production text-clipping
 * family: pages that scroll sideways, text running under a chip, and text
 * that overflows its box without an ellipsis.
 */

/**
 * The page never scrolls sideways, and nothing pokes past the right edge.
 * The global CSS sets `overflow-x: hidden` on phones, which hides the
 * scrollbar but not the cut-off content, so this also checks every visible
 * element's box (except inside a container that scrolls or clips on purpose).
 */
export async function expectNoHorizontalScroll(page: Page) {
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
  expect(result.scrollWidth, "document scrolls sideways").toBeLessThanOrEqual(result.innerWidth);
  expect(result.offenders, "elements past the right edge").toEqual([]);
}

/**
 * Text is never cut off or covered:
 * - an element with its own text whose content is wider than its box must
 *   show an ellipsis (`text-overflow: ellipsis`) or be a deliberate scroller;
 * - no text overlaps a chip or badge next to it.
 */
export async function expectNoClippedText(page: Page, scope?: Locator) {
  const root = scope ? await scope.elementHandle() : null;
  const problems = await page.evaluate((rootEl) => {
    const base = (rootEl as Element | null) ?? document.body;
    const out: string[] = [];
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

    // 1. Overflowing text without an ellipsis.
    for (const el of Array.from(base.querySelectorAll<HTMLElement>("*"))) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof SVGElement) continue;
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (!ownText || !visible(el) || srOnly(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
      if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis") {
        out.push(`overflows without ellipsis: ${describe(el)} (${el.scrollWidth} > ${el.clientWidth})`);
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
            out.push(`text under ${describe(chip)}: "${n.textContent.trim().slice(0, 40)}"`);
            break;
          }
        }
      }
    }
    return out.slice(0, 15);
  }, root);
  expect(problems, problems.join("\n")).toEqual([]);
}
