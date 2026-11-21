const CANDIDATES =
  "a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable=''], [contenteditable='true']";

function shown(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node === root ? null : node.parentElement) {
    if (node.hidden || node.hasAttribute("inert")) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** The elements inside `root` that Tab stops at, in DOM order (positive tabindex is not used in orrn). */
export function tabbablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "hidden") return false;
    return shown(el, root);
  });
}

/**
 * Whether a Tab from `target` would leave `root`: forward from its last tabbable, backward from its first, or either
 * way from `root` itself. A non-modal sheet stops Radix's focus loop only there, so every other Tab is left alone
 * (review N8).
 */
export function tabLeaves(root: HTMLElement, target: EventTarget | null, shift: boolean): boolean {
  if (target === root) return true;
  const list = tabbablesIn(root);
  if (list.length === 0) return false;
  return shift ? target === list[0] : target === list[list.length - 1];
}
