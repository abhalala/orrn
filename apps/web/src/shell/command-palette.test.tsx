import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import type { PaletteBodyProps, RemoteSearch } from "./command-palette";
import { readRecents, recentStorageKey, takePaletteVisit } from "./palette/recents";
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
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });

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

  test("sheet commands run after the palette closes, not after a timer", async () => {
    // This harness keeps `open` true (onOpenChange only records the request), so the palette never finishes
    // closing: the command must still be waiting after a timer tick. The run after a real close, with focus
    // already back on the opener, is the QA F0 test at the end of this file.
    let closed = false;
    const view = await renderPalette({ arrangeAvailable: true, onOpenChange: (o) => void (closed = !o) });
    try {
      await type(view.input(), ">arrange");
      await key(view.input(), "Enter");
      expect(closed).toBe(true);
      expect(view.calls.arrange).toBe(0);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(view.calls.arrange).toBe(0);
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

describe("command palette: fix round", () => {
  test("live region: says the mode once, then only settled counts, not every keystroke (review S3)", async () => {
    const view = await renderPalette();
    try {
      const input = view.input();
      const heard: string[] = [];
      const region = document.querySelector("[data-testid='palette-live']")!;
      const observer = new MutationObserver(() => heard.push(region.textContent ?? ""));
      observer.observe(region, { childList: true, characterData: true, subtree: true });
      await type(input, ">");
      expect(live()).toMatch(/^Commands only\. \d+ commands$/);
      for (const q of ["t", "th", "the", "them", "theme"]) await type(input, q);
      // Typing fast: nothing new until the input settles.
      expect(live()).toMatch(/^Commands only\. \d+ commands$/);
      await settle();
      // Settled: the count alone, the mode is not repeated.
      expect(live()).toMatch(/^\d+ commands?$/);
      await key(input, "Backspace");
      for (let i = 0; i < 5; i++) await type(input, "theme".slice(0, 4 - i));
      await type(input, "");
      await key(input, "Backspace");
      await settle();
      expect(live()).toMatch(/^Search\. \d+ results?$/);
      // Search mode: no announcement per keystroke either.
      const before = heard.length;
      for (const q of ["s", "st", "sto", "stoc"]) await type(input, q);
      expect(heard.length).toBe(before);
      await settle();
      expect(live()).toMatch(/^Search\. \d+ results?$/);
      observer.disconnect();
      expect(heard.filter((h) => h.startsWith("Commands only")).length).toBe(1);
    } finally {
      await view.cleanup();
    }
  });

  test("opening the palette empty announces what it lists", async () => {
    const view = await renderPalette();
    try {
      expect(live()).toBe(`Search. ${options().length} results`);
    } finally {
      await view.cleanup();
    }
  });

  test("Enter while remote rows are for an older query opens nothing stale (review S4)", async () => {
    const remote: RemoteSearch = (query, enabled) => ({
      rows: enabled
        ? [{ id: `dispatch-${query}`, group: "dispatches", label: `DSP for ${query}`, icon: () => null, action: { kind: "go", to: `/dispatch/${query}` } }]
        : [],
      fetching: false,
    });
    const view = await renderPalette({ useRemote: remote as RemoteSearch });
    try {
      const input = view.input();
      await type(input, "zzq");
      await settle();
      expect(options().map((o) => o.textContent)).toEqual(["DSP for zzq"]);
      // One more letter, Enter before the debounce: the "zzq" row must not be opened for "zzqx".
      await type(input, "zzqx");
      await key(input, "Enter");
      expect(view.calls.go).toEqual([]);
      await settle();
      await key(input, "Enter");
      expect(view.calls.go).toEqual([["/dispatch/zzqx", undefined]]);
    } finally {
      await view.cleanup();
    }
  });

  test("Enter that confirms an IME composition does not open a row (review S4)", async () => {
    const view = await renderPalette();
    try {
      const input = view.input();
      await type(input, "stock");
      await act(async () => {
        const e = new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }) as unknown as KeyboardEvent;
        if (!e.isComposing) Object.defineProperty(e, "isComposing", { value: true });
        input.dispatchEvent(e as unknown as Event);
      });
      expect(view.calls.go).toEqual([]);
      await key(input, "Enter");
      expect(view.calls.go[0]?.[0]).toBe("/stock");
    } finally {
      await view.cleanup();
    }
  });

  test("typo false positives: cast does not list Customers; डाइ finds Dies first (review S1, S2)", async () => {
    const view = await renderPalette();
    try {
      await type(view.input(), "cast");
      expect(document.querySelector("[data-result-id='page-customers']")).toBeNull();
      expect(document.querySelector("[data-result-id='page-masters']")).toBeNull();
      await type(view.input(), "stock");
      const secondary = Array.from(document.querySelectorAll("[data-testid='palette-secondary']")).map((x) => x.textContent ?? "");
      expect(secondary.some((x) => x.includes("sticker"))).toBe(false);
      await type(view.input(), "डाइ");
      expect(options()[0]?.dataset.resultId).toBe("page-dies");
    } finally {
      await view.cleanup();
    }
  });

  test("a punctuation-only query lists nothing (review M1)", async () => {
    const view = await renderPalette();
    try {
      await type(view.input(), "-");
      expect(options()).toHaveLength(0);
      await type(view.input(), ">");
      await type(view.input(), ">");
      expect(options()).toHaveLength(0);
    } finally {
      await view.cleanup();
    }
  });

  test("Open bundle from a typed serial is not saved as recent: it may not exist (QA F1)", async () => {
    const view = await renderPalette();
    try {
      await type(view.input(), "NOPE-1");
      await key(view.input(), "Enter");
      expect(view.calls.go[0]?.[0]).toBe("/b/NOPE-1");
      expect(readRecents("user-1", "plant-1")).toEqual([]);
    } finally {
      await view.cleanup();
    }
  });

  test("choosing a section marks the visit, so the route hook does not add its page too (QA F2)", async () => {
    const view = await renderPalette();
    try {
      await type(view.input(), "printers");
      await key(view.input(), "Enter");
      expect(view.calls.go[0]).toEqual(["/printing", { tab: "printers" }]);
      expect(readRecents("user-1", "plant-1")).toEqual([{ kind: "section", ref: "printing.printers" }]);
      expect(takePaletteVisit("/printing")).toBe(true);
      expect(takePaletteVisit("/printing")).toBe(false);
    } finally {
      await view.cleanup();
    }
  });

  test("the page you are on is not listed under Recent", async () => {
    localStorage.setItem(
      recentStorageKey("user-1", "plant-1"),
      JSON.stringify([
        { kind: "page", ref: "today" },
        { kind: "section", ref: "printing.printers" },
        { kind: "page", ref: "masters" },
      ]),
    );
    const view = await renderPalette({ here: { pathname: "/today", search: {} } });
    try {
      const recent = document.querySelector<HTMLElement>("[data-group='recent']")!;
      expect(Array.from(recent.querySelectorAll("[role='option']")).map((o) => o.textContent)).toEqual(["PrintersPrinting", "Masters"]);
    } finally {
      await view.cleanup();
    }
    localStorage.setItem(
      recentStorageKey("user-1", "plant-1"),
      JSON.stringify([
        { kind: "section", ref: "printing.printers" },
        { kind: "page", ref: "masters" },
      ]),
    );
    const onPrinters = await renderPalette({ here: { pathname: "/printing", search: { tab: "printers" } } });
    try {
      const recent = document.querySelector<HTMLElement>("[data-group='recent']")!;
      expect(Array.from(recent.querySelectorAll("[role='option']")).map((o) => o.textContent)).toEqual(["Masters"]);
    } finally {
      await onPrinters.cleanup();
    }
  });
});

describe("command palette: sheet commands and focus (QA F0)", () => {
  test("a sheet command runs only after the palette has closed and given focus back to its opener", async () => {
    const { PaletteBody } = await import("./command-palette");
    const { useState } = await import("react");
    const seen: { scanFocus: string | null; arrangeFocus: string | null } = { scanFocus: null, arrangeFocus: null };
    let setOpen: (open: boolean) => void = () => {};
    const focusName = () => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute("data-testid") ?? el?.tagName ?? null;
    };
    function Harness() {
      const [open, set] = useState(false);
      setOpen = set;
      return (
        <I18nProvider locale="en">
          <button type="button" data-testid="opener" onClick={() => set(true)}>
            Scan or search
          </button>
          <PaletteBody
            open={open}
            onOpenChange={set}
            me={testMe("owner")}
            theme="system"
            scanAvailable
            arrangeAvailable
            useRemote={stubRemote}
            effects={{
              go: () => {},
              navigate: () => {},
              openScan: () => void (seen.scanFocus = focusName()),
              switchPlant: () => {},
              setLocale: () => {},
              setTheme: () => {},
              openArrange: () => void (seen.arrangeFocus = focusName()),
              signOut: () => {},
            }}
          />
        </I18nProvider>
      );
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
    try {
      await act(async () => root.render(<Harness />));
      for (const [command, field] of [
        ["scan", "scanFocus"],
        ["arrange", "arrangeFocus"],
      ] as const) {
        const opener = document.querySelector<HTMLButtonElement>("[data-testid='opener']")!;
        opener.focus();
        await act(async () => opener.click());
        await wait(10);
        const input = document.querySelector<HTMLInputElement>("input[role='combobox']")!;
        await type(input, `>${command}`);
        await key(input, "Enter");
        // Not yet: the palette is still closing.
        expect(seen[field]).toBeNull();
        await wait(300);
        // Ran once, and by then focus was back on the opener, so the sheet's own focus wins after it.
        expect(seen[field]).toBe("opener");
        await act(async () => setOpen(false));
        await wait(50);
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      document.body.innerHTML = "";
    }
  });
});

describe("command palette: announcements across reopening", () => {
  test("each open announces once, from the fresh state, never the last session's mode or query", async () => {
    const { PaletteBody } = await import("./command-palette");
    const { useState } = await import("react");
    localStorage.setItem(recentStorageKey("user-1", "plant-1"), JSON.stringify([{ kind: "page", ref: "masters" }, { kind: "page", ref: "stock" }]));
    let setOpen: (open: boolean) => void = () => {};
    function Harness() {
      const [open, set] = useState(false);
      setOpen = set;
      return (
        <I18nProvider locale="en">
          <PaletteBody
            open={open}
            onOpenChange={set}
            me={testMe("owner")}
            theme="system"
            scanAvailable
            arrangeAvailable={false}
            useRemote={stubRemote}
            effects={{ go: () => {}, navigate: () => {}, openScan: () => {}, switchPlant: () => {}, setLocale: () => {}, setTheme: () => {}, openArrange: () => {}, signOut: () => {} }}
          />
        </I18nProvider>
      );
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
    // Every text the live region showed while open, in order. The observer callback runs after a batch of DOM
    // changes, so the texts in between come from the records (old values and removed nodes), then the final text.
    let seen: string[] = [];
    const inRegion = (n: Node | null) => !!(n && (n.parentElement ?? (n as Element)).closest?.("[data-testid='palette-live']"));
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData" && inRegion(r.target)) seen.push(r.oldValue ?? "");
        if (r.type === "childList" && (r.target as Element).matches?.("[data-testid='palette-live']")) {
          for (const n of Array.from(r.removedNodes)) seen.push(n.textContent ?? "");
        }
        // The region arriving with the dialog: the text it was inserted with.
        for (const n of Array.from(r.addedNodes)) {
          const region = n instanceof window.Element ? (n.matches("[data-testid='palette-live']") ? n : n.querySelector("[data-testid='palette-live']")) : null;
          if (region) seen.push(region.textContent ?? "");
        }
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, characterDataOldValue: true, subtree: true });
    const openAndListen = async () => {
      seen = [];
      await act(async () => setOpen(true));
      await wait(300);
      const all = [...seen, live()].filter((x) => x !== "");
      const heard = all.filter((x, i) => x !== all[i - 1]);
      return { heard, rows: options().length };
    };
    try {
      await act(async () => root.render(<Harness />));
      const first = await openAndListen();
      expect(first.heard).toEqual([`Search. ${first.rows} results`]);
      // Leave it in command mode with a query, as running ">scan" does.
      await type(document.querySelector<HTMLInputElement>("input[role='combobox']")!, ">scan");
      await wait(200);
      await act(async () => setOpen(false));
      await wait(300);
      const second = await openAndListen();
      expect(second.heard).toEqual([`Search. ${second.rows} results`]);
      // Leave a search query behind.
      await type(document.querySelector<HTMLInputElement>("input[role='combobox']")!, "sto");
      await wait(250);
      await act(async () => setOpen(false));
      await wait(300);
      const third = await openAndListen();
      expect(third.heard).toEqual([`Search. ${third.rows} results`]);
    } finally {
      observer.disconnect();
      await act(async () => root.unmount());
      host.remove();
      document.body.innerHTML = "";
      localStorage.clear();
    }
  });
});
