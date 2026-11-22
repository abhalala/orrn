import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import { testMe } from "@/shell/palette/test-me";
import { trpc } from "@/shared/utils/trpc";

import { initialChat } from "./chat-model";
import { installDom, settle, typeInto } from "./test-dom";

/**
 * Delta round S5, N8, N9, N10: where the open panel sits at each width, what it does to the page, and Tab in the
 * non-modal (docked) panel. The rest of the panel is covered by `panel-body.test.tsx`.
 */

const env = installDom();
beforeAll(() => env.install());
afterAll(() => env.uninstall());

/** The window width every `min-width` query answers for; changed in place to act out a resize. */
const viewport = { width: 1280 };

function stubViewport() {
  const before = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    if (min) return { matches: viewport.width >= Number(min[1]), media: query, addEventListener() {}, removeEventListener() {} };
    return before.call(window, query);
  }) as never;
  return () => {
    window.matchMedia = before;
  };
}

const rootStyle = () => document.documentElement.style;

async function renderPanel(width: number) {
  viewport.width = width;
  const { BuddyPanelBody } = await import("./panel-body");
  const restore = stubViewport();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, { ...testMe("owner"), buddy: true } as never);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const opener = document.createElement("button");
  opener.textContent = "Open Buddy";
  document.body.appendChild(opener);
  opener.focus();
  const root: Root = createRoot(host);
  let setOpen: (open: boolean) => void = () => {};

  function Harness() {
    const [open, set] = useState(true);
    setOpen = set;
    return (
      <BuddyPanelBody
        open={open}
        onOpenChange={set}
        chat={{ state: initialChat(), busy: false, send() {}, retry() {}, newChat() {} }}
        drafts={[]}
        decisions={{ pendingFor: () => null, errorFor: () => null, confirm() {}, reject() {} }}
        when={(at) => new Date(at).toISOString()}
      />
    );
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <I18nProvider locale="en">
          <Harness />
        </I18nProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return {
    dialog: () => document.querySelector<HTMLElement>("[role='dialog']"),
    q: (id: string) => document.querySelector<HTMLElement>(`[data-testid='${id}']`),
    async setOpen(open: boolean) {
      await act(async () => setOpen(open));
      await settle(50);
    },
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
      opener.remove();
      document.body.innerHTML = "";
      restore();
    },
  };
}

describe("S5: from 1024 px the panel docks beside the page", () => {
  test("1280 px: non-modal, the page inset and the toast offset are set while it is open and removed on close", async () => {
    const view = await renderPanel(1280);
    try {
      expect(view.dialog()?.getAttribute("aria-modal")).toBe("false");
      expect(document.querySelector("[data-slot='sheet-overlay']")).toBeNull();
      expect(view.q("buddy-panel")?.dataset.dock).toBe("docked");
      expect(rootStyle().getPropertyValue("--orrn-buddy-inset")).toBe("400px");
      expect(rootStyle().getPropertyValue("--orrn-toast-right")).toBe("calc(400px + 24px)");
      await view.setOpen(false);
      expect(rootStyle().getPropertyValue("--orrn-buddy-inset")).toBe("");
      expect(rootStyle().getPropertyValue("--orrn-toast-right")).toBe("");
    } finally {
      await view.cleanup();
    }
  });

  test("1024 px is the first docked width", async () => {
    const view = await renderPanel(1024);
    try {
      expect(view.dialog()?.getAttribute("aria-modal")).toBe("false");
      expect(rootStyle().getPropertyValue("--orrn-buddy-inset")).toBe("400px");
    } finally {
      await view.cleanup();
    }
  });

  test("900 px (768 to 1023): the modal sheet over a dimmed page; the page is not moved, toasts start left of the sheet", async () => {
    const view = await renderPanel(900);
    try {
      expect(view.dialog()?.getAttribute("aria-modal")).toBe("true");
      expect(document.querySelector("[data-slot='sheet-overlay']")).not.toBeNull();
      expect(view.q("buddy-panel")?.dataset.dock).toBe("sheet");
      expect(rootStyle().getPropertyValue("--orrn-buddy-inset")).toBe("");
      expect(rootStyle().getPropertyValue("--orrn-toast-right")).toBe("calc(min(400px, calc(100vw - 404px)) + 48px)");
      await view.setOpen(false);
      expect(rootStyle().getPropertyValue("--orrn-toast-right")).toBe("");
    } finally {
      await view.cleanup();
    }
  });
});

describe("N10: the mode is read when the panel opens", () => {
  test("docked at 1280, a resize to a phone width while open keeps it docked; the next opening reads the width again", async () => {
    const view = await renderPanel(1280);
    try {
      viewport.width = 375;
      // Any render after the resize (here: typing) must not switch the open panel to the modal sheet.
      await typeInto(view.q("buddy-input") as HTMLTextAreaElement, "hello");
      await settle(50);
      expect(view.dialog()?.getAttribute("aria-modal")).toBe("false");
      expect(view.q("buddy-panel")?.dataset.dock).toBe("docked");
      expect(rootStyle().getPropertyValue("--orrn-buddy-inset")).toBe("400px");
      await view.setOpen(false);
      await view.setOpen(true);
      expect(view.dialog()?.getAttribute("aria-modal")).toBe("true");
      expect(rootStyle().getPropertyValue("--orrn-buddy-inset")).toBe("");
    } finally {
      await view.cleanup();
    }
  });
});

describe("N8: the non-modal panel lets Tab through to its controls", () => {
  const tabbables = (dialog: HTMLElement) =>
    Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], textarea")).filter((el) => el.tabIndex >= 0);

  test("a Tab inside the panel reaches the focused control's own handler", async () => {
    const view = await renderPanel(1280);
    try {
      const input = view.q("buddy-input")!;
      const heard: string[] = [];
      input.addEventListener("keydown", (e) => heard.push((e as KeyboardEvent).key));
      input.focus();
      await env.key(input, "Tab");
      await env.key(input, "Tab", { shiftKey: true });
      expect(heard).toEqual(["Tab", "Tab"]);
    } finally {
      await view.cleanup();
    }
  });

  test("Tab from the last control and Shift+Tab from the first are not looped back into the panel", async () => {
    const view = await renderPanel(1280);
    try {
      const list = tabbables(view.dialog()!);
      expect(list.length).toBeGreaterThan(1);
      const first = list[0]!;
      const last = list.at(-1)!;
      last.focus();
      const forward = await env.key(last, "Tab");
      expect(forward.defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(first);
      first.focus();
      const back = await env.key(first, "Tab", { shiftKey: true });
      expect(back.defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(last);
    } finally {
      await view.cleanup();
    }
  });
});
