import { useRef } from "react";

/**
 * Radix Dialog only returns focus to a `Dialog.Trigger`. Our sheets and
 * dialogs are controlled (`open` / `onOpenChange`) and opened by ordinary
 * buttons, so without this focus would fall to <body> on close. Spread the
 * result on `Dialog.Content`: it remembers what had focus when the dialog
 * opened and puts focus back there when it closes. When that element is no
 * longer on the page, focus goes to the page's h1 instead of <body>.
 */
export function useReturnFocus() {
  const previous = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const active = document.activeElement;
      previous.current = active instanceof HTMLElement && active !== document.body ? active : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const el = previous.current;
      previous.current = null;
      if (el?.isConnected) {
        event.preventDefault();
        el.focus({ preventScroll: true });
        return;
      }
      // The button that opened it is gone. If the page already moved focus on
      // purpose (the packing list after Dispatch), leave it there.
      const active = document.activeElement;
      const keep =
        active instanceof HTMLElement &&
        active !== document.body &&
        active.isConnected &&
        !active.closest("[role='dialog'], [role='alertdialog']");
      if (el && keep) {
        event.preventDefault();
        return;
      }
      // Otherwise (the row it acted on was approved, removed or replaced): the
      // page heading, never <body>.
      const heading = document.querySelector<HTMLElement>("main h1");
      if (el && heading) {
        event.preventDefault();
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    },
  };
}
