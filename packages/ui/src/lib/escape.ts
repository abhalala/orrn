/**
 * For Sheet/Dialog `onEscapeKeyDown`. Radix listens for Escape on the
 * document in the capture phase, before the focused input sees it. While a
 * combobox list is open (`aria-expanded="true"`), leave that Escape to the
 * combobox, which closes its list; the next Escape closes the sheet.
 */
export function escapeUnlessComboboxOpen(event: { target: EventTarget | null; preventDefault(): void }) {
  const target = event.target;
  if (target instanceof Element && target.closest("[role='combobox'][aria-expanded='true']")) {
    event.preventDefault();
  }
}
