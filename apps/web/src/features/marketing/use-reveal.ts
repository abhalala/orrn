import { useLayoutEffect, type RefObject } from "react";

/**
 * Section entrances, once each: marks the page `data-motion="ready"` (the
 * hidden starting state only applies under it, so content stays visible
 * without script) and sets `data-in` on each `[data-reveal]` block as it
 * first comes into view. A jump past a block (a link to an anchor, the End
 * key) reveals it too, so nothing above the viewport stays hidden.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const page = root.current;
    if (!page || typeof IntersectionObserver === "undefined") return;
    page.dataset.motion = "ready";
    const reveal = (element: Element) => {
      (element as HTMLElement).dataset.in = "true";
      observer.unobserve(element);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) reveal(entry.target);
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    const pending = () => page.querySelectorAll("[data-reveal]:not([data-in])");
    // Blocks mount with their sections; a MutationObserver keeps late ones (a breakpoint swap) covered.
    const watch = () => pending().forEach((element) => observer.observe(element));
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(page, { childList: true, subtree: true });

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const left = pending();
        for (const element of left) if (element.getBoundingClientRect().top < innerHeight) reveal(element);
        if (left.length === 0) removeEventListener("scroll", onScroll);
      });
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      delete page.dataset.motion;
    };
  }, [root]);
}
