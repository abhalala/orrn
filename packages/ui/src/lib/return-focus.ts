import { useRef } from "react";

/**
 * Radix Dialog only returns focus to a `Dialog.Trigger`. Our sheets and
 * dialogs are controlled (`open` / `onOpenChange`) and opened by ordinary
 * buttons, so without this focus would fall to <body> on close. Spread the
 * result on `Dialog.Content`: it remembers what had focus when the dialog
 * opened and puts focus back there when it closes.
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
      }
    },
  };
}
