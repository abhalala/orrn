import { useRef } from "react";

/**
 * Radix Dialog only returns focus to a `Dialog.Trigger`. Our sheets and
 * dialogs are controlled (`open` / `onOpenChange`) and opened by ordinary
 * buttons, so without this focus would fall to <body> on close. Spread the
 * result on `Dialog.Content`: it remembers what had focus when the dialog
 * opened and puts focus back there when it closes. When that element is no
 * longer on the page, focus goes to the page's h1 instead of <body>.
 * Pass `open` so the opener is read before the dialog's children can take focus.
 */
export function useReturnFocus(open?: boolean) {
  const previous = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const remember = () => {
    const active = document.activeElement;
    previous.current = active instanceof HTMLElement && active !== document.body ? active : null;
  };
  // Read the opener while the dialog is being rendered open, before its children mount. A child with `autoFocus`
  // (a scan field) takes focus during that commit, so by the time Radix's `onOpenAutoFocus` runs the opener is
  // already gone and focus would fall to the page heading on close. Writing a ref here is idempotent (StrictMode safe).
  if (open === true && !wasOpen.current) {
    wasOpen.current = true;
    remember();
  } else if (open === false) {
    wasOpen.current = false;
  }
  return {
    onOpenAutoFocus: () => {
      // Dialogs opened without the `open` argument still record here.
      if (open === undefined) remember();
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
