import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import type { PaletteBodyProps, RemoteSearch } from "./command-palette";
import { recentStorageKey } from "./palette/recents";
import { testMe } from "./palette/test-me";

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

const remoteCalls: { query: string; enabled: boolean }[] = [];
const stubRemote: RemoteSearch = (query, enabled) => {
  remoteCalls.push({ query, enabled });
  return { rows: [], fetching: false };
};

type Calls = { go: [string, unknown][]; theme: string[]; locale: string[]; scan: number; arrange: number; signOut: number };

async function renderPalette(props: Partial<PaletteBodyProps> = {}, locale: "en" | "hi" = "en") {
  const { PaletteBody } = await import("./command-palette");
  const calls: Calls = { go: [], theme: [], locale: [], scan: 0, arrange: 0, signOut: 0 };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const full: PaletteBodyProps = {
    open: true,
    onOpenChange: () => {},
    me: testMe("owner"),
    theme: "system",
    scanAvailable: true,
    arrangeAvailable: false,
    useRemote: stubRemote,
    effects: {
      go: (to, search) => void calls.go.push([to, search]),
      navigate: (to) => void calls.go.push([to, undefined]),
      openScan: () => void calls.scan++,
      switchPlant: () => {},
      setLocale: (l) => void calls.locale.push(l),
      setTheme: (v) => void calls.theme.push(v),
      openArrange: () => void calls.arrange++,
      signOut: () => void calls.signOut++,
    },
    ...props,
  };
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <PaletteBody {...full} />
      </I18nProvider>,
    );
  });
  const input = () => document.querySelector<HTMLInputElement>("input[role='combobox']")!;
  const cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
    // Radix can leave the closing portal behind; never let the next test find this palette's input.
    document.body.innerHTML = "";
    try {
      localStorage.clear();
    } catch {
      // The storage-throws test swaps localStorage out.
    }
  };
  return { calls, input, cleanup };
}

async function type(input: HTMLInputElement, value: string) {
  // Set the value under React's value tracker (the setter on the element's own prototype chain), then fire input.
  let proto: object | null = Object.getPrototypeOf(input);
  let setter: ((v: string) => void) | undefined;
  while (proto && !setter) {
    setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    proto = Object.getPrototypeOf(proto);
  }
  // react-dom loads before this file installs the DOM, so it sees no "input" event support and watches the focused
  // field's value on keyup instead (its old-browser path). Fire both.
  await act(async () => {
    if (document.activeElement !== input) input.focus();
    setter!.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keyup", { key: "Unidentified", bubbles: true }));
  });
}

async function key(element: HTMLElement, value: string) {
  await act(async () => {
    element.dispatchEvent(new dom.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }) as unknown as Event);
  });
}

const options = () => Array.from(document.querySelectorAll<HTMLElement>("[role='option']"));
const activeOption = (input: HTMLInputElement) => document.getElementById(input.getAttribute("aria-activedescendant") ?? "");
const groups = () => Array.from(document.querySelectorAll<HTMLElement>("[role='group']")).map((g) => g.dataset.group);
const live = () => document.querySelector("[data-testid='palette-live']")?.textContent ?? "";

describe("command palette", () => {
  test("empty query: recent items first, then pages; groups are named", async () => {
    localStorage.setItem(
      recentStorageKey("user-1", "plant-1"),
      JSON.stringify([
        { kind: "bundle", ref: "26I4086", label: "26I4086", to: "/b/26I4086", mono: true },
        { kind: "page", ref: "masters" },
      ]),
    );
    const view = await renderPalette();
    try {
      expect(groups()).toEqual(["recent", "pages"]);
      const recent = document.querySelector<HTMLElement>("[data-group='recent']")!;
      expect(recent.getAttribute("aria-label")).toBe("Recent");
      expect(Array.from(recent.querySelectorAll("[role='option']")).map((o) => o.textContent)).toEqual(["26I4086", "Masters"]);
      await key(view.input(), "Enter");
      expect(view.calls.go[0]).toEqual(["/b/26I4086", undefined]);
    } finally {
      localStorage.clear();
      await view.cleanup();
    }
  });

  test("recent items a person can no longer open are not shown", async () => {
    localStorage.setItem(recentStorageKey("user-1", "plant-1"), JSON.stringify([{ kind: "page", ref: "masters" }]));
    const view = await renderPalette({ me: testMe("viewer") });
    try {
      expect(groups()).toEqual(["pages"]);
    } finally {
      localStorage.clear();
      await view.cleanup();
    }
  });

  test("storage that throws: the palette still opens with pages", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    Object.defineProperty(window, "localStorage", { configurable: true, value: throwing });
    const view = await renderPalette();
    try {
      expect(groups()).toEqual(["pages"]);
      await type(view.input(), "stock");
      await key(view.input(), "Enter");
      expect(view.calls.go[0]?.[0]).toBe("/stock");
    } finally {
      await view.cleanup();
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  test("keyboard: arrows, Home, End, PageDown, PageUp, Enter", async () => {
    const view = await renderPalette();
    try {
      const input = view.input();
      const all = options();
      expect(all.length).toBeGreaterThan(6);
      expect(activeOption(input)).toBe(all[0]!);
      await key(input, "ArrowDown");
      expect(activeOption(input)).toBe(all[1]!);
      await key(input, "End");
      expect(activeOption(input)).toBe(all[all.length - 1]!);
      await key(input, "ArrowDown");
      expect(activeOption(input)).toBe(all[0]!);
      await key(input, "PageDown");
      expect(activeOption(input)).toBe(all[5]!);
      await key(input, "PageUp");
      expect(activeOption(input)).toBe(all[0]!);
      await key(input, "PageUp");
      expect(activeOption(input)).toBe(all[0]!);
      await key(input, "End");
      await key(input, "Home");
      expect(activeOption(input)).toBe(all[0]!);
      await key(input, "ArrowUp");
      expect(activeOption(input)?.getAttribute("aria-selected")).toBe("true");
      await key(input, "Enter");
      expect(view.calls.go).toHaveLength(1);
    } finally {
      await view.cleanup();
    }
  });

  test("a page name wins Enter over a command that contains it", async () => {
    const view = await renderPalette();
    try {
      await type(view.input(), "dispatch");
      await key(view.input(), "Enter");
      expect(view.calls.go[0]?.[0]).toBe("/dispatch");
    } finally {
      await view.cleanup();
    }
  });

  test("command mode: '>' shows commands only, says so, skips remote search, Backspace leaves it", async () => {
    const view = await renderPalette();
    try {
      const input = view.input();
      await type(input, ">");
      expect(input.value).toBe("");
      expect(document.querySelector("[data-testid='palette-command-mode']")).not.toBeNull();
      expect(input.placeholder).toBe("Type a command");
      expect(input.getAttribute("aria-label")).toBe("Scan or search. Commands only");
      expect(groups()).toEqual(["commands"]);
      expect(live()).toMatch(/^Commands only\. \d+ commands$/);

      remoteCalls.length = 0;
      await type(input, "26I4086");
      expect(groups()).toEqual(["commands"].filter(() => options().length > 0));
      expect(document.querySelector("[data-result-id^='bundle-']")).toBeNull();
      expect(remoteCalls.every((c) => !c.enabled)).toBe(true);

      await type(input, "light");
      expect(options()[0]?.textContent).toContain("Light theme");
      await type(input, "");
      await key(input, "Backspace");
      expect(document.querySelector("[data-testid='palette-command-mode']")).toBeNull();
      expect(input.placeholder).toBe("Type a serial, dispatch code, die or customer");
      expect(groups()).toEqual(["pages"]);
    } finally {
      await view.cleanup();
    }
  });

  test("running a command calls the shell's logic", async () => {
    const view = await renderPalette();
    try {
      await type(view.input(), ">light theme");
      await key(view.input(), "Enter");
      expect(view.calls.theme).toEqual(["light"]);
    } finally {
      await view.cleanup();
    }
  });

  test("commands a person cannot use are hidden", async () => {
    const view = await renderPalette({ me: testMe("viewer") });
    try {
      await type(view.input(), ">");
      const labels = options().map((o) => o.textContent ?? "");
      expect(labels.some((l) => l.includes("New dispatch"))).toBe(false);
      expect(labels.some((l) => l.includes("New order"))).toBe(false);
      expect(labels.some((l) => l.includes("Sign out"))).toBe(true);
    } finally {
      await view.cleanup();
    }
  });

  test("an alias match shows the matched word", async () => {
    const view = await renderPalette();
    try {
      await type(view.input(), "challan");
      // The live region waits for the remote search debounce (160 ms).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 220));
      });
      const secondary = Array.from(document.querySelectorAll("[data-testid='palette-secondary']")).map((s) => s.textContent);
      expect(secondary.some((s) => s?.includes("matched: challan"))).toBe(true);
      expect(live()).toMatch(/^Search\. \d+ results?$/);
    } finally {
      await view.cleanup();
    }
  });

  test("Hindi UI still finds pages by their English name", async () => {
    const { loadMessages } = await import("@orrn/i18n");
    await loadMessages("hi");
    const view = await renderPalette({}, "hi");
    try {
      await type(view.input(), "stock");
      await key(view.input(), "Enter");
      expect(view.calls.go[0]?.[0]).toBe("/stock");
    } finally {
      await view.cleanup();
    }
  });

  test("a page section opens its route with its search params", async () => {
    const view = await renderPalette();
    try {
      await type(view.input(), "spectro handled");
      await key(view.input(), "Enter");
      expect(view.calls.go[0]).toEqual(["/casts/inbox", { tab: "handled" }]);
    } finally {
      await view.cleanup();
    }
  });

  test("a section stricter than its page: hidden from a viewer; for others the command row carries its words", async () => {
    const viewer = await renderPalette({ me: testMe("viewer") });
    try {
      await type(viewer.input(), "ship date");
      expect(document.querySelector("[data-result-id='section-dispatch.new']")).toBeNull();
      expect(document.querySelector("[data-result-id='cmd-new-dispatch']")).toBeNull();
    } finally {
      await viewer.cleanup();
    }
    const owner = await renderPalette();
    try {
      await type(owner.input(), "ship date");
      expect(document.querySelector("[data-result-id='section-dispatch.new']")).toBeNull();
      const row = document.querySelector<HTMLElement>("[data-result-id='cmd-new-dispatch']");
      expect(row?.textContent).toContain("matched: ship date");
    } finally {
      await owner.cleanup();
    }
  });

  test("sheet commands run after the palette closes", async () => {
    let closed = false;
    const view = await renderPalette({ arrangeAvailable: true, onOpenChange: (o) => void (closed = !o) });
    try {
      await type(view.input(), ">arrange");
      await key(view.input(), "Enter");
      expect(closed).toBe(true);
      expect(view.calls.arrange).toBe(0);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(view.calls.arrange).toBe(1);
    } finally {
      await view.cleanup();
    }
  });

  test("no recents are read or written while impersonating", async () => {
    localStorage.setItem(recentStorageKey("user-1", "plant-1"), JSON.stringify([{ kind: "page", ref: "stock" }]));
    const view = await renderPalette({ me: testMe("owner", { impersonating: true }) });
    try {
      expect(groups()).toEqual(["pages"]);
      localStorage.clear();
      await type(view.input(), "stock");
      await key(view.input(), "Enter");
      expect(view.calls.go[0]?.[0]).toBe("/stock");
      expect(localStorage.length).toBe(0);
    } finally {
      await view.cleanup();
    }
  });
});
