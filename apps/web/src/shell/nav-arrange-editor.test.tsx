import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import { TENANT_MORE, TENANT_PRIMARY } from "./nav-items";

const dom = new Window({ url: "http://localhost/today" });
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
  "Node",
  "NodeFilter",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "CustomEvent",
  "MutationObserver",
  "ResizeObserver",
  "DOMRect",
  "getComputedStyle",
] as const;
const previous = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
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
});

afterAll(async () => {
  await dom.happyDOM.close();
  for (const name of globalNames) {
    const descriptor = previous.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function rowOrder() {
  return Array.from(document.querySelectorAll("[data-slot='nav-arrange-list'] > li")).map(
    (row) => (row as HTMLElement).dataset.navKey ?? "more",
  );
}

async function key(element: HTMLElement, value: string) {
  await act(async () => {
    element.dispatchEvent(new dom.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
  });
}

describe("NavArrangeEditor keyboard arranging", () => {
  test("pick up, move, drop, cancel, announcement and focus", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const { default: NavArrangeEditor } = await import("./nav-arrange-editor");
    const groups = {
      primary: TENANT_PRIMARY.slice(0, 3),
      more: [TENANT_MORE.find((item) => item.key === "orders")!, TENANT_MORE.find((item) => item.key === "guides")!],
    };

    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={new QueryClient()}>
            <I18nProvider locale="en">
              <NavArrangeEditor open onOpenChange={() => {}} groups={groups} companyId="plant-a" onSaved={() => {}} />
            </I18nProvider>
          </QueryClientProvider>,
        );
      });

      expect(rowOrder()).toEqual(["today", "pack", "stock", "more", "orders", "guides"]);
      const handle = document.querySelector<HTMLElement>("[data-nav-key='orders'] button[aria-label='Reorder Orders']")!;
      await act(async () => handle.focus());
      await key(handle, " ");
      expect(handle.getAttribute("aria-pressed")).toBe("true");

      await key(handle, "ArrowDown");
      expect(rowOrder()).toEqual(["today", "pack", "stock", "more", "guides", "orders"]);
      expect(document.querySelector("[data-testid='nav-order-announcement']")?.textContent).toBe(
        "Orders moved to position 5 of 5",
      );
      expect(document.activeElement).toBe(handle);

      await key(handle, "Enter");
      expect(handle.getAttribute("aria-pressed")).toBe("false");
      expect(document.activeElement).toBe(handle);

      await key(handle, " ");
      await key(handle, "ArrowUp");
      expect(rowOrder()).toEqual(["today", "pack", "stock", "more", "orders", "guides"]);
      await key(handle, "Escape");
      expect(rowOrder()).toEqual(["today", "pack", "stock", "more", "guides", "orders"]);
      expect(handle.getAttribute("aria-pressed")).toBe("false");
      expect(document.activeElement).toBe(handle);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
