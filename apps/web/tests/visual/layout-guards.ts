import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Reusable layout guards for Playwright specs.
 *
 * `expectNoHorizontalScroll` fails when the page (or the app shell's scroll
 * regions) can scroll sideways, or when a visible element sticks out past the
 * right edge of the viewport outside a deliberate horizontal scroller.
 *
 * `expectNoClippedText` fails when text is cut off without an ellipsis, runs
 * under a status chip, breaks a long token (slug, code, email) across lines,
 * is squeezed into a column too narrow to read, or when a key value marked
 * `data-no-truncate` (big numbers, weights, die codes) is ellipsised at all.
 *
 * Both run inside the page so they see the real computed layout. Each issue is
 * reported with a short CSS path and the offending text so a failure points
 * straight at the element.
 */

export type LayoutIssue = {
  kind: string;
  path: string;
  text: string;
  detail: string;
};

type GuardOptions = {
  /** Extra CSS selectors to ignore (e.g. third-party overlays). */
  ignore?: string[];
};

const DEFAULT_IGNORE = [
  ".TanStackRouterDevtools",
  ".tsqd-parent-container",
  "[class*='tsqd-']",
  "[data-sonner-toaster]",
  "[data-layout-guard-ignore]",
];

export async function collectHorizontalScrollIssues(
  page: Page,
  options: GuardOptions = {},
): Promise<LayoutIssue[]> {
  const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];
  return page.evaluate((ignoreSelectors) => {
    const issues: { kind: string; path: string; text: string; detail: string }[] = [];
    const vw = document.documentElement.clientWidth;

    const pathOf = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && parts.length < 4 && node !== document.body) {
        const cls = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
        parts.unshift(`${node.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`);
        node = node.parentElement;
      }
      return parts.join(" > ");
    };
    const isIgnored = (el: Element) => ignoreSelectors.some((sel) => el.closest(sel));

    const scroller = document.scrollingElement ?? document.documentElement;
    if (scroller.scrollWidth > scroller.clientWidth + 1) {
      issues.push({
        kind: "page-scroll",
        path: "document",
        text: "",
        detail: `document scrollWidth ${scroller.scrollWidth} > clientWidth ${scroller.clientWidth}`,
      });
    }

    // Inside the app shell only <main> scrolls; the document itself must not
    // (absolutely positioned text escaping <main> makes it scroll).
    if (document.querySelector("[data-shell-row]") && scroller.scrollHeight > scroller.clientHeight + 1) {
      issues.push({
        kind: "page-scroll-y",
        path: "document",
        text: "",
        detail: `document scrollHeight ${scroller.scrollHeight} > clientHeight ${scroller.clientHeight} inside the app shell`,
      });
    }

    // App shell regions must never gain a sideways scroll range, even a
    // hidden one (focus and scrollIntoView can still scroll overflow:hidden).
    const shell = [
      document.body,
      document.getElementById("root"),
      ...Array.from(document.querySelectorAll("main, .orrn-app-content, [data-shell-row]")),
    ].filter(Boolean) as Element[];
    for (const el of shell) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "clip") {
        issues.push({
          kind: "shell-scroll",
          path: pathOf(el),
          text: "",
          detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
        });
      }
      if (el.scrollLeft > 0) {
        issues.push({ kind: "shell-scrolled", path: pathOf(el), text: "", detail: `scrollLeft ${el.scrollLeft}` });
      }
    }

    const insideHorizontalScroller = (el: Element): boolean => {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const ox = getComputedStyle(node).overflowX;
        if ((ox === "auto" || ox === "scroll") && node.tagName !== "MAIN") return true;
        node = node.parentElement;
      }
      return false;
    };

    // Right edge actually painted: clipped by any overflow ancestor (text cut
    // by an ellipsis or a clip box does not stick out of the viewport).
    const paintedRight = (el: Element, right: number, stopAt?: Element | null): number => {
      let r = right;
      let node = el.parentElement;
      while (node && node !== document.body && node !== stopAt) {
        if (getComputedStyle(node).overflowX !== "visible") {
          r = Math.min(r, node.getBoundingClientRect().right);
        }
        node = node.parentElement;
      }
      return r;
    };

    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (isIgnored(el)) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      if (rect.right > vw + 1 && rect.left < vw && !insideHorizontalScroller(el) && paintedRight(el, rect.right) > vw + 1) {
        // Inside a fixed overlay (sheet, dialog, popover) the overlay itself is
        // the frame; only report when the overlay itself is on screen.
        issues.push({
          kind: "past-viewport",
          path: pathOf(el),
          text: (el.textContent ?? "").trim().slice(0, 60),
          detail: `right ${Math.round(rect.right)} > viewport ${vw}`,
        });
      }
    }
    // The app content column clips sideways overflow (so the page never
    // scrolls); anything sticking past its padding edge is still a bug.
    const content = document.querySelector(".orrn-app-content");
    if (content) {
      const cs = getComputedStyle(content);
      const inner = content.getBoundingClientRect().right - parseFloat(cs.paddingRight) + 1;
      for (const el of Array.from(content.querySelectorAll("*"))) {
        if (isIgnored(el)) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.position === "fixed") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue;
        if (rect.right > inner && !insideHorizontalScroller(el) && paintedRight(el, rect.right, content) > inner) {
          issues.push({
            kind: "past-content",
            path: pathOf(el),
            text: (el.textContent ?? "").trim().slice(0, 60),
            detail: `right ${Math.round(rect.right)} > content edge ${Math.round(inner - 1)}`,
          });
        }
      }
    }

    // Report the outermost offenders only.
    const seen = new Set<string>();
    return issues.filter((i) => {
      const key = `${i.kind}:${i.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);
  }, ignore);
}

export async function collectClippedTextIssues(
  page: Page,
  scope?: Locator | string,
  options: GuardOptions = {},
): Promise<LayoutIssue[]> {
  const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];
  const run = (root: Element, args: { ignoreSelectors: string[] }) => {
    const issues: { kind: string; path: string; text: string; detail: string }[] = [];
    const base = root;

    const pathOf = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && parts.length < 4 && node !== document.body) {
        const cls = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
        parts.unshift(`${node.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`);
        node = node.parentElement;
      }
      return parts.join(" > ");
    };
    const isIgnored = (el: Element) => args.ignoreSelectors.some((sel) => el.closest(sel));
    const isVisuallyHidden = (el: Element): boolean => {
      let node: Element | null = el;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return true;
        const r = node.getBoundingClientRect();
        if ((r.width <= 1 || r.height <= 1) && (s.overflow === "hidden" || s.position === "absolute")) return true;
        node = node.parentElement;
      }
      return false;
    };

    // Find the nearest ancestor (or self) that clips horizontally.
    const clipperOf = (el: Element): Element | null => {
      let node: Element | null = el;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (s.overflowX !== "visible") return node;
        node = node.parentElement;
      }
      return null;
    };

    // 0. Key values marked `data-no-truncate` (big numbers, weights, codes on
    //    cards) must show in full: touch users cannot hover for a title.
    for (const el of Array.from(base.querySelectorAll("[data-no-truncate]"))) {
      if (isIgnored(el) || isVisuallyHidden(el)) continue;
      const targets = [el, ...Array.from(el.querySelectorAll("*"))];
      for (const t of targets) {
        const cs = getComputedStyle(t);
        const clamped = cs.webkitLineClamp !== "none" && cs.webkitLineClamp !== "" && cs.webkitLineClamp !== undefined;
        const cut = t.scrollWidth > t.clientWidth + 1 && cs.overflowX !== "visible";
        if (cs.textOverflow === "ellipsis" || clamped || cut) {
          issues.push({
            kind: "truncated-key-value",
            path: pathOf(t),
            text: (t.textContent ?? "").trim().slice(0, 60),
            detail: cs.textOverflow === "ellipsis" ? "ellipsised" : clamped ? "line-clamped" : `cut: scrollWidth ${t.scrollWidth} > clientWidth ${t.clientWidth}`,
          });
          break;
        }
      }
    }

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent && n.textContent.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

    // The part of a box actually on screen: intersected with every clipping
    // ancestor (a chip scrolled under the bottom nav is not "under" its text).
    const visibleBox = (el: Element) => {
      const r = el.getBoundingClientRect();
      let box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      let node = el.parentElement;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") {
          const p = node.getBoundingClientRect();
          box = {
            left: Math.max(box.left, p.left),
            right: Math.min(box.right, p.right),
            top: Math.max(box.top, p.top),
            bottom: Math.min(box.bottom, p.bottom),
          };
        }
        node = node.parentElement;
      }
      return box;
    };
    const chips = Array.from(base.querySelectorAll("[data-slot='badge']")).filter(
      (c) => !isIgnored(c) && !isVisuallyHidden(c),
    );
    const chipRects = chips
      .map((c) => ({ el: c, rect: visibleBox(c) }))
      .filter(({ rect }) => rect.right - rect.left > 0 && rect.bottom - rect.top > 0);

    const reported = new Set<Element>();
    for (const node of textNodes) {
      const el = node.parentElement;
      if (!el || reported.has(el)) continue;
      if (isIgnored(el) || isVisuallyHidden(el)) continue;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "OPTION" || tag === "TITLE") continue;
      if (el.closest("svg")) continue;

      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;
      const text = (node.textContent ?? "").trim();

      // 1. Cut off without an ellipsis.
      const clipper = clipperOf(el);
      if (clipper) {
        const cs = getComputedStyle(clipper);
        const scrolls = cs.overflowX === "auto" || cs.overflowX === "scroll";
        const ellipsis = getComputedStyle(el).textOverflow === "ellipsis" || cs.textOverflow === "ellipsis";
        const cr = clipper.getBoundingClientRect();
        const right = Math.max(...rects.map((r) => r.right));
        const left = Math.min(...rects.map((r) => r.left));
        if (!scrolls && !ellipsis && (right > cr.right + 1.5 || left < cr.left - 1.5)) {
          issues.push({
            kind: "clipped",
            path: pathOf(el),
            text: text.slice(0, 60),
            detail: `text spans ${Math.round(left)}-${Math.round(right)}, clipped to ${Math.round(cr.left)}-${Math.round(cr.right)}`,
          });
          reported.add(el);
          continue;
        }
      }

      // 2. Visible overflow: a single-line text box whose content is wider
      //    than the box spills into its neighbours.
      const elStyle = getComputedStyle(el);
      if (
        elStyle.display !== "inline" &&
        elStyle.overflowX === "visible" &&
        el.scrollWidth > el.clientWidth + 1 &&
        el.clientWidth > 0 &&
        el.children.length === 0
      ) {
        issues.push({
          kind: "spills",
          path: pathOf(el),
          text: text.slice(0, 60),
          detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
        });
        reported.add(el);
        continue;
      }

      // 3. Text running under a status chip. Only the visible part counts:
      //    an ellipsised span's range still reports the full text width.
      let visibleRects = rects;
      if (clipper) {
        const box = clipper.getBoundingClientRect();
        visibleRects = rects
          .map((r) => {
            const left = Math.max(r.left, box.left);
            const right = Math.min(r.right, box.right);
            return { left, right, top: r.top, bottom: r.bottom, width: right - left };
          })
          .filter((r) => r.width > 0) as unknown as DOMRect[];
      }
      let overlapped = false;
      for (const { el: chip, rect: cr } of chipRects) {
        if (chip.contains(el) || el.contains(chip)) continue;
        for (const r of visibleRects) {
          const w = Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
          const h = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
          if (w > 1.5 && h > 1.5) {
            issues.push({
              kind: "under-chip",
              path: pathOf(el),
              text: text.slice(0, 60),
              detail: `overlaps chip "${(chip.textContent ?? "").trim()}" by ${Math.round(w)}x${Math.round(h)}px`,
            });
            overlapped = true;
            break;
          }
        }
        if (overlapped) break;
      }
      if (overlapped) {
        reported.add(el);
        continue;
      }

      // 4. A long unbroken token (slug, code, email, id) broken across lines.
      // Prose words with one hyphen ("tenant-isolated") may wrap at the
      // hyphen; codes, slugs, emails, ids and anything in mono must not.
      const tokenRe = /\S{10,}/g;
      const mono = /mono/i.test(elStyle.fontFamily);
      let m: RegExpExecArray | null;
      let broken = false;
      while ((m = tokenRe.exec(node.textContent ?? "")) && !broken) {
        const token = m[0].replace(/[,.;:!?)]+$/, "");
        const codeLike =
          mono || /[@\d_/]/.test(token) || (token.match(/-/g) ?? []).length >= 2 || /^[a-z0-9]{16,}$/i.test(token);
        if (!codeLike) continue;
        const tr = document.createRange();
        tr.setStart(node, m.index);
        tr.setEnd(node, m.index + m[0].length);
        const lines = new Set(
          Array.from(tr.getClientRects())
            .filter((r) => r.width > 0)
            .map((r) => Math.round(r.top)),
        );
        if (lines.size > 1) {
          issues.push({
            kind: "token-wrap",
            path: pathOf(el),
            text: m[0].slice(0, 60),
            detail: `long token wraps over ${lines.size} lines`,
          });
          broken = true;
        }
      }
      if (broken) {
        reported.add(el);
        continue;
      }

      // 5. Squeezed column: several words stacked one per line in a box too
      //    narrow to read ("Oct / 6, / 2026").
      const lineTops = new Set(rects.map((r) => Math.round(r.top)));
      const words = text.split(/\s+/).filter(Boolean).length;
      const box = el.getBoundingClientRect();
      if (lineTops.size >= 3 && words >= 2 && words <= lineTops.size + 1 && box.width < 96) {
        issues.push({
          kind: "squeezed",
          path: pathOf(el),
          text: text.slice(0, 60),
          detail: `${words} words on ${lineTops.size} lines in a ${Math.round(box.width)}px box`,
        });
        reported.add(el);
      }
    }
    return issues.slice(0, 25);
  };

  const root =
    typeof scope === "string" ? page.locator(scope).first() : (scope ?? page.locator("body"));
  return root.evaluate(run, { ignoreSelectors: ignore });
}

function format(issues: LayoutIssue[]): string {
  return issues.map((i) => `[${i.kind}] ${i.path}\n    "${i.text}" (${i.detail})`).join("\n");
}

/** Fails when the page or the app shell can scroll sideways. */
export async function expectNoHorizontalScroll(page: Page, options?: GuardOptions) {
  // Poll briefly: portals (toaster) can overflow for a frame while styles inject.
  let issues: LayoutIssue[] = [];
  await expect
    .poll(
      async () => {
        issues = await collectHorizontalScrollIssues(page, options);
        return issues.length;
      },
      { timeout: 3000 },
    )
    .toBe(0)
    .catch(() => {
      throw new Error(`Horizontal overflow on ${page.url()}:\n${format(issues)}`);
    });
}

/** Fails when text is clipped without an ellipsis, runs under a chip, or wraps a long token. */
export async function expectNoClippedText(page: Page, scope?: Locator | string, options?: GuardOptions) {
  const issues = await collectClippedTextIssues(page, scope, options);
  expect(issues, `Clipped text on ${page.url()}:\n${format(issues)}`).toEqual([]);
}
