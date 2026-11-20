/**
 * Test-only: a happy-dom window installed on the globals for one test file (the pattern of `command-palette.test.tsx`),
 * plus small event helpers. Imported only by `*.test.tsx` files.
 */
import { Window } from "happy-dom";
import { act } from "react";

const globalNames = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "Element",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "HTMLAnchorElement",
  "Node",
  "NodeFilter",
  "Event",
  "FocusEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "CustomEvent",
  "MutationObserver",
  "ResizeObserver",
  "DOMRect",
  "getComputedStyle",
] as const;

export function installDom(url = "http://localhost/today") {
  const dom = new Window({ url });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  return {
    dom,
    install() {
      for (const name of globalNames) {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        const fallback = name === "PointerEvent" ? dom.MouseEvent : undefined;
        Object.defineProperty(globalThis, name, {
          configurable: true,
          writable: true,
          value: (dom as unknown as Record<string, unknown>)[name] ?? fallback,
        });
      }
      Object.assign(globalThis, {
        requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
        cancelAnimationFrame: (id: number) => clearTimeout(id),
        IS_REACT_ACT_ENVIRONMENT: true,
      });
    },
    async uninstall() {
      await dom.happyDOM.close();
      for (const name of globalNames) {
        const descriptor = previous.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
    async key(element: Element, key: string, init: { shiftKey?: boolean; isComposing?: boolean } = {}) {
      let event: Event | undefined;
      await act(async () => {
        event = new dom.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }) as unknown as Event;
        element.dispatchEvent(event);
      });
      return event!;
    },
    async click(element: Element) {
      await act(async () => {
        (element as HTMLElement).click();
      });
    },
  };
}

/** Types into a textarea or input under React's value tracker (see `command-palette.test.tsx`). */
export async function typeInto(input: HTMLTextAreaElement | HTMLInputElement, value: string) {
  let proto: object | null = Object.getPrototypeOf(input);
  let setter: ((v: string) => void) | undefined;
  while (proto && !setter) {
    setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    proto = Object.getPrototypeOf(proto);
  }
  await act(async () => {
    if (document.activeElement !== input) input.focus();
    setter!.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keyup", { key: "Unidentified", bubbles: true }));
  });
}

export const settle = (ms = 30) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
