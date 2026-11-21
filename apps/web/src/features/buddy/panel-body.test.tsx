import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import { testMe } from "@/shell/palette/test-me";
import { trpc } from "@/shared/utils/trpc";

import { focusOpenPanel, returnFocusTo, showBuddy } from "./buddy-launcher";
import { chatReducer, initialChat, type ChatState } from "./chat-model";
import { failureText, reviewPath } from "./draft-card";
import type { BuddyPanelBodyProps, DraftDecisions } from "./panel-body";
import { installDom, settle, typeInto } from "./test-dom";
import type { BuddyDraft } from "./types";

const env = installDom();
beforeAll(() => env.install());
afterAll(() => env.uninstall());

const DRAFT: BuddyDraft = {
  id: "d1",
  path: "orders.create",
  kind: "procedure",
  title: "New order for KD Traders",
  fields: [
    { key: "customerId", label: "Customer id", value: "KD Traders" },
    { key: "lines", label: "Lines", value: "12170, 500 kg" },
  ],
  items: null,
  status: "pending",
  createdAt: "2026-11-20T06:00:00Z",
  expiresAt: "2026-11-21T06:00:00Z",
  result: null,
  failure: null,
  link: null,
  origin: "chat",
  decidedVia: null,
  drive: null,
};

type Calls = { sent: string[]; retried: string[]; newChat: number; open: boolean[]; confirmed: string[]; rejected: string[] };

function stateWith(...steps: Parameters<typeof chatReducer>[1][]): ChatState {
  return steps.reduce(chatReducer, initialChat("c1"));
}

/** Phone 375 px (the full-screen modal sheet) or desktop 1280 px (the non-modal panel docked beside the page, N9, S5). */
type Viewport = "phone" | "desktop";
const WIDTH: Record<Viewport, number> = { phone: 375, desktop: 1280 };

/** Answers `min-width` queries for the given width; anything else goes to the matchMedia already installed. */
function stubViewport(viewport: Viewport) {
  const before = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    if (min) return { matches: WIDTH[viewport] >= Number(min[1]), media: query, addEventListener() {}, removeEventListener() {} };
    return before.call(window, query);
  }) as never;
  return () => {
    window.matchMedia = before;
  };
}

async function renderPanel(
  props: Partial<Omit<BuddyPanelBodyProps, "chat">> & {
    state?: ChatState;
    busy?: boolean;
    role?: "owner" | "viewer";
    locale?: "en" | "hi";
    viewport?: Viewport;
  } = {},
) {
  const { BuddyPanelBody } = await import("./panel-body");
  const restoreViewport = stubViewport(props.viewport ?? "phone");
  const calls: Calls = { sent: [], retried: [], newChat: 0, open: [], confirmed: [], rejected: [] };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, { ...testMe(props.role ?? "owner"), buddy: true } as never);
  const decisions: DraftDecisions = props.decisions ?? {
    pendingFor: () => null,
    errorFor: () => null,
    confirm: (d) => void calls.confirmed.push(d.id),
    reject: (d) => void calls.rejected.push(d.id),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  // A launcher-like button outside the dialog, so focus has somewhere to come back to.
  const opener = document.createElement("button");
  opener.textContent = "Open Buddy";
  document.body.appendChild(opener);
  opener.focus();
  const root: Root = createRoot(host);

  function Harness() {
    const [open, setOpen] = useState(props.open ?? true);
    return (
      <BuddyPanelBody
        open={open}
        onOpenChange={(next) => {
          calls.open.push(next);
          setOpen(next);
        }}
        chat={{
          state: props.state ?? initialChat(),
          busy: props.busy ?? false,
          send: (m) => void calls.sent.push(m),
          retry: (id) => void calls.retried.push(id),
          newChat: () => void calls.newChat++,
        }}
        drafts={props.drafts ?? []}
        decisions={decisions}
        when={(at) => new Date(at).toISOString().slice(0, 16)}
      />
    );
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <I18nProvider locale={props.locale ?? "en"}>
          <Harness />
        </I18nProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  const dialog = () => document.querySelector<HTMLElement>("[role='dialog']");
  const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid='${id}']`);
  const qa = (id: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid='${id}']`));
  const cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
    opener.remove();
    document.body.innerHTML = "";
    restoreViewport();
  };
  return { calls, dialog, q, qa, opener, host, cleanup };
}

describe("on a phone the Buddy panel is a modal dialog", () => {
  test("role dialog, aria-modal, named by its Buddy heading, over a dimmed page", async () => {
    const view = await renderPanel();
    try {
      const dialog = view.dialog()!;
      expect(dialog).not.toBeNull();
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      const labelledBy = dialog.getAttribute("aria-labelledby")!;
      expect(document.getElementById(labelledBy)?.textContent).toBe("Buddy");
      expect(view.q("buddy-new-chat")?.textContent).toContain("New chat");
      expect(dialog.querySelector("textarea")?.getAttribute("aria-label")).toBe("Message to Buddy");
      expect(document.querySelector("[data-slot='sheet-overlay']")).not.toBeNull();
      // The page behind is hidden from screen readers while the sheet covers it.
      expect(view.opener.getAttribute("aria-hidden")).toBe("true");
      // Toasts stay where they are: nothing sits beside the page.
      expect(document.documentElement.style.getPropertyValue("--orrn-toast-right")).toBe("");
    } finally {
      await view.cleanup();
    }
  });

  test("focus moves into the dialog and Tab is trapped inside it", async () => {
    const view = await renderPanel();
    try {
      const dialog = view.dialog()!;
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(view.q("buddy-input"));
      const tabbables = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], textarea"));
      const last = tabbables.at(-1)!;
      last.focus();
      await env.key(last, "Tab");
      expect(document.activeElement).toBe(tabbables[0]!);
      await env.key(tabbables[0]!, "Tab", { shiftKey: true });
      expect(document.activeElement).toBe(last);
    } finally {
      await view.cleanup();
    }
  });

  test("Escape closes it and focus goes back to the button that opened it", async () => {
    const view = await renderPanel();
    try {
      await env.key(document.activeElement ?? view.dialog()!, "Escape");
      await settle(50);
      expect(view.calls.open).toEqual([false]);
      expect(view.dialog()).toBeNull();
      expect(document.activeElement).toBe(view.opener);
    } finally {
      await view.cleanup();
    }
  });
});

describe("from 1024 px the Buddy panel is a non-modal dialog docked beside the page (N9, delta S5)", () => {
  test("still the Buddy dialog, but aria-modal false, no overlay, and the page is neither hidden nor inert", async () => {
    const view = await renderPanel({ viewport: "desktop" });
    try {
      const dialog = view.dialog()!;
      expect(dialog).not.toBeNull();
      expect(dialog.getAttribute("aria-modal")).toBe("false");
      expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Buddy");
      expect(document.querySelector("[data-slot='sheet-overlay']")).toBeNull();
      for (const el of [view.opener, view.host]) {
        expect(el.getAttribute("aria-hidden")).toBeNull();
        expect(el.hasAttribute("inert")).toBe(false);
        expect(el.closest("[aria-hidden='true'], [inert]")).toBeNull();
      }
      // Focus still moves in on open.
      expect(document.activeElement).toBe(view.q("buddy-input"));
    } finally {
      await view.cleanup();
    }
  });

  test("focus moves out to the page and back without closing it, and Tab is not trapped", async () => {
    const view = await renderPanel({ viewport: "desktop" });
    try {
      const dialog = view.dialog()!;
      const tabbables = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], textarea"));
      const last = tabbables.at(-1)!;
      last.focus();
      await env.key(last, "Tab");
      // Not wrapped back to the first control: Tab leaves the panel the browser's way.
      expect(document.activeElement).not.toBe(tabbables[0]!);
      // The page takes focus and a click; the panel stays open.
      await act(async () => {
        view.opener.focus();
        view.opener.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      });
      await settle(50);
      expect(document.activeElement).toBe(view.opener);
      expect(view.calls.open).toEqual([]);
      expect(view.dialog()).not.toBeNull();
      // The way back: the Buddy button takes focus into the panel's message box.
      await act(async () => void focusOpenPanel());
      expect(document.activeElement).toBe(view.q("buddy-input"));
    } finally {
      await view.cleanup();
    }
  });

  test("Escape on the page is the page's; Escape in the panel closes it and focus goes back to the button", async () => {
    const view = await renderPanel({ viewport: "desktop" });
    try {
      view.opener.focus();
      await env.key(view.opener, "Escape");
      await settle(50);
      expect(view.calls.open).toEqual([]);
      expect(view.dialog()).not.toBeNull();
      const input = view.q("buddy-input")!;
      input.focus();
      await env.key(input, "Escape");
      await settle(50);
      expect(view.calls.open).toEqual([false]);
      expect(view.dialog()).toBeNull();
      expect(document.activeElement).toBe(view.opener);
    } finally {
      await view.cleanup();
    }
  });

  test("toasts move left of the open panel, and back when it closes", async () => {
    const view = await renderPanel({ viewport: "desktop" });
    try {
      // Delta S5: docked, the panel is a 400 px column at the edge, so toasts start 24 px left of it.
      expect(document.documentElement.style.getPropertyValue("--orrn-toast-right")).toBe("calc(400px + 24px)");
      const input = view.q("buddy-input")!;
      await env.key(input, "Escape");
      await settle(50);
      expect(document.documentElement.style.getPropertyValue("--orrn-toast-right")).toBe("");
    } finally {
      await view.cleanup();
    }
  });

  test("focusOpenPanel finds nothing to focus while the panel is closed", () => {
    expect(focusOpenPanel()).toBe(false);
  });
});

describe("messages and the live region", () => {
  test("a streaming answer shows as it comes but is not announced; the finished answer is", async () => {
    const streaming = stateWith(
      { type: "send", turnId: "t1", message: "how much 12170 is in the yard" },
      { type: "event", turnId: "t1", event: { type: "tool", path: "stock.summary" } },
      { type: "event", turnId: "t1", event: { type: "text", delta: "About 500" } },
    );
    const view = await renderPanel({ state: streaming, busy: true });
    try {
      expect(view.q("buddy-reply")?.textContent).toContain("About 500");
      expect(view.q("buddy-tool")?.textContent).toBe("Used orrn: stock.summary");
      expect(view.q("buddy-working")?.textContent).toBe("Buddy is writing");
      const live = view.q("buddy-live")!;
      expect(live.getAttribute("aria-live")).toBe("polite");
      expect(live.textContent).toBe("");
      // The streamed text sits outside any live region.
      expect(view.q("buddy-reply")!.closest("[aria-live]")).toBeNull();
    } finally {
      await view.cleanup();
    }
    const done = chatReducer(streaming, { type: "end", turnId: "t1", end: { kind: "done", conversationId: "c1" } });
    const view2 = await renderPanel({ state: done });
    try {
      expect(view2.q("buddy-live")?.textContent).toBe("About 500");
      expect(view2.q("buddy-working")).toBeNull();
    } finally {
      await view2.cleanup();
    }
  });

  test("connecting shows its own line", async () => {
    const view = await renderPanel({ state: stateWith({ type: "send", turnId: "t1", message: "hi" }), busy: true });
    try {
      expect(view.q("buddy-working")?.textContent).toBe("Connecting");
      expect(view.q<HTMLButtonElement>("buddy-send")!.disabled).toBe(true);
    } finally {
      await view.cleanup();
    }
  });

  test("offline: one line on the turn, said once in the live region, and Try again is the person's choice", async () => {
    const state = stateWith({ type: "send", turnId: "t1", message: "hi" }, { type: "end", turnId: "t1", end: { kind: "error", code: "offline" } });
    const view = await renderPanel({ state });
    try {
      expect(view.qa("buddy-offline").map((e) => e.textContent)).toEqual(["Buddy is offline. Try again later."]);
      expect(view.q("buddy-live")?.textContent).toBe("Buddy is offline. Try again later.");
      expect(view.calls.retried).toEqual([]);
      await env.click(view.q("buddy-retry")!);
      expect(view.calls.retried).toEqual(["t1"]);
    } finally {
      await view.cleanup();
    }
  });

  test("an answer that stopped part way gets its own error and Retry", async () => {
    const state = stateWith({ type: "send", turnId: "t1", message: "hi" }, { type: "end", turnId: "t1", end: { kind: "cut" } });
    const view = await renderPanel({ state });
    try {
      expect(view.q("buddy-turn-error")?.textContent).toContain("The answer stopped before the end.");
      expect(view.q("buddy-offline")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("Enter sends, Shift+Enter does not, and an Enter that picks a word on a Hindi keyboard does not", async () => {
    const view = await renderPanel();
    try {
      const box = view.q<HTMLTextAreaElement>("buddy-input")!;
      await typeInto(box, "make an order for KD");
      const shift = await env.key(box, "Enter", { shiftKey: true });
      expect(shift.defaultPrevented).toBe(false);
      await env.key(box, "Enter", { isComposing: true });
      expect(view.calls.sent).toEqual([]);
      await env.key(box, "Enter");
      expect(view.calls.sent).toEqual(["make an order for KD"]);
      expect(box.value).toBe("");
    } finally {
      await view.cleanup();
    }
  });

  test("New chat asks the chat to start over", async () => {
    const view = await renderPanel();
    try {
      await env.click(view.q("buddy-new-chat")!);
      expect(view.calls.newChat).toBe(1);
    } finally {
      await view.cleanup();
    }
  });

  test("Add a file opens the normal import upload and steps the panel aside; no file input in the chat", async () => {
    const view = await renderPanel();
    try {
      const link = view.q<HTMLAnchorElement>("buddy-add-file")!;
      expect(link.getAttribute("href")).toBe("/ingest");
      expect(link.textContent).toBe("Add a file");
      expect(view.dialog()!.querySelector("input[type='file']")).toBeNull();
      link.addEventListener("click", (e) => e.preventDefault());
      await env.click(link);
      expect(view.calls.open).toEqual([false]);
    } finally {
      await view.cleanup();
    }
  });

  test("Hindi: the panel speaks Hindi", async () => {
    const view = await renderPanel({ locale: "hi" });
    try {
      expect(view.q("buddy-new-chat")?.textContent).toContain("नई बातचीत");
      expect(view.q("buddy-add-file")?.textContent).toBe("फ़ाइल जोड़ें");
    } finally {
      await view.cleanup();
    }
  });
});

describe("draft cards", () => {
  const withDraft = stateWith(
    { type: "send", turnId: "t1", message: "make an order for KD, 500 kg 12170" },
    { type: "event", turnId: "t1", event: { type: "draft", draftId: "d1" } },
    { type: "end", turnId: "t1", end: { kind: "done", conversationId: "c1" } },
  );

  test("a pending draft shows its lines with Confirm and Reject, and each calls its decision", async () => {
    const view = await renderPanel({ state: withDraft, drafts: [DRAFT] });
    try {
      const card = view.q("buddy-draft")!;
      expect(card.textContent).toContain("New order for KD Traders");
      expect(card.textContent).toContain("KD Traders");
      expect(card.textContent).toContain("Waiting");
      await env.click(view.q("buddy-draft-confirm")!);
      await env.click(view.q("buddy-draft-reject")!);
      expect(view.calls.confirmed).toEqual(["d1"]);
      expect(view.calls.rejected).toEqual(["d1"]);
    } finally {
      await view.cleanup();
    }
  });

  test("a draft not yet in the list shows a loading line; a pending draft from elsewhere waits at the top", async () => {
    const view = await renderPanel({ state: withDraft, drafts: [{ ...DRAFT, id: "d2", title: "Hold for KD" }] });
    try {
      expect(view.q("buddy-draft-loading")?.textContent).toBe("Loading the change");
      expect(document.getElementById("buddy-waiting")?.textContent).toBe("Waiting for you");
      expect(view.q("buddy-draft")?.textContent).toContain("Hold for KD");
    } finally {
      await view.cleanup();
    }
  });

  test("decided drafts have no buttons; a failed one says why in the person's words, never the server's sentence", async () => {
    const view = await renderPanel({
      state: withDraft,
      drafts: [{ ...DRAFT, status: "failed", failure: "SQLITE_CONSTRAINT: something internal" }],
    });
    try {
      expect(view.q("buddy-draft-confirm")).toBeNull();
      const card = view.q("buddy-draft")!;
      expect(card.textContent).toContain("Failed");
      expect(card.textContent).not.toContain("SQLITE");
    } finally {
      await view.cleanup();
    }
  });

  test("Confirm and Reject are hidden from a role that cannot use Buddy", async () => {
    const view = await renderPanel({ state: withDraft, drafts: [DRAFT], role: "viewer" });
    try {
      expect(view.q("buddy-draft")).not.toBeNull();
      expect(view.q("buddy-draft-confirm")).toBeNull();
      expect(view.q("buddy-draft-reject")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("a decision on its way disables both buttons; a failed decision shows its error", async () => {
    const view = await renderPanel({
      state: withDraft,
      drafts: [DRAFT],
      decisions: { pendingFor: () => "confirm", errorFor: () => "Could not confirm. Try again.", confirm: () => {}, reject: () => {} },
    });
    try {
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(true);
      expect(view.q<HTMLButtonElement>("buddy-draft-reject")!.disabled).toBe(true);
      expect(view.q("buddy-draft")!.querySelector("[role='alert']")?.textContent).toBe("Could not confirm. Try again.");
    } finally {
      await view.cleanup();
    }
  });

  test("an import draft carries its review link, which steps the panel aside", async () => {
    const view = await renderPanel({ state: withDraft, drafts: [{ ...DRAFT, path: "ingest.answer.set", link: "/ingest/review/cand_42" }] });
    try {
      const link = view.q<HTMLAnchorElement>("buddy-draft-review")!;
      expect(link.getAttribute("href")).toBe("/ingest/review/cand_42");
      // An import draft's title comes from the dictionary, not the server's English words.
      expect(view.q("buddy-draft")!.querySelector("h3")!.textContent).toBe("Answer the import's question");
      link.addEventListener("click", (e) => e.preventDefault());
      await env.click(link);
      expect(view.calls.open).toEqual([false]);
    } finally {
      await view.cleanup();
    }
  });
});

describe("reviewPath", () => {
  const origin = "https://app.orrn.in";
  test("an import page path, or a full link on this host, becomes an in-app path", () => {
    expect(reviewPath("/ingest/review/cand_42", origin)).toBe("/ingest/review/cand_42");
    expect(reviewPath("https://app.orrn.in/ingest/files/art-7", origin)).toBe("/ingest/files/art-7");
  });
  test("another host, another page or a script link gets no link", () => {
    expect(reviewPath("https://evil.example/ingest/review/x", origin)).toBeNull();
    expect(reviewPath("//evil.example/ingest/review/x", origin)).toBeNull();
    expect(reviewPath("javascript:alert(1)", origin)).toBeNull();
    expect(reviewPath("/settings?tab=buddy", origin)).toBeNull();
    expect(reviewPath(null, origin)).toBeNull();
  });
});

describe("who gets the bubble", () => {
  test("an owner with Buddy on; not a viewer, not when the server says no, not while impersonating", () => {
    expect(showBuddy({ ...testMe("owner"), buddy: true })).toBe(true);
    expect(showBuddy({ ...testMe("owner"), buddy: false })).toBe(false);
    expect(showBuddy(testMe("owner"))).toBe(false);
    expect(showBuddy({ ...testMe("viewer"), buddy: true })).toBe(false);
    expect(showBuddy({ ...testMe("admin"), buddy: true })).toBe(false);
    expect(showBuddy({ ...testMe("owner", { impersonating: true }), buddy: true })).toBe(false);
    expect(showBuddy(undefined)).toBe(false);
  });
});

describe("the v2 draft card shows exactly what Confirm runs (S10, M1)", () => {
  const withDraft = stateWith(
    { type: "send", turnId: "t1", message: "answer the questions" },
    { type: "event", turnId: "t1", event: { type: "draft", draftId: "d1" } },
    { type: "end", turnId: "t1", end: { kind: "done", conversationId: "c1" } },
  );
  const answers: BuddyDraft = {
    ...DRAFT,
    path: "import.answerQuestions",
    kind: "answers",
    title: "Answer the import questions",
    fields: [{ key: "candidateId", label: "Candidate", value: "Orders 2025.xlsx, sheet Jan" }],
    items: Array.from({ length: 12 }, (_, i) => ({ label: `Customer ${i + 1}`, value: i === 11 ? "LAST ONE" : "new customer" })),
    link: "/ingest/review/c1",
  };

  test("field names come from the app's word map in the person's language; an unknown key keeps the server's label", async () => {
    const view = await renderPanel({ state: withDraft, drafts: [answers], locale: "hi" });
    try {
      const card = view.q("buddy-draft")!;
      expect(card.querySelector("dt")!.textContent).toBe("शीट");
      expect(card.querySelector("h3")!.textContent).toBe("इम्पोर्ट के सवालों के जवाब दें");
    } finally {
      await view.cleanup();
    }
    const other = await renderPanel({ state: withDraft, drafts: [{ ...DRAFT, fields: [{ key: "gstin", label: "Gstin", value: "24AAA" }] }] });
    try {
      expect(other.q("buddy-draft")!.querySelector("dt")!.textContent).toBe("Gstin");
    } finally {
      await other.cleanup();
    }
  });

  test("a long list says how many lines it runs and Confirm waits until all of them were shown", async () => {
    const view = await renderPanel({ state: withDraft, drafts: [answers] });
    try {
      expect(view.q("buddy-draft-items-count")!.textContent).toBe("This runs 12 lines");
      expect(view.qa("buddy-draft-item")).toHaveLength(5);
      expect(view.q("buddy-draft")!.textContent).not.toContain("LAST ONE");
      const confirm = view.q<HTMLButtonElement>("buddy-draft-confirm")!;
      expect(confirm.disabled).toBe(true);
      expect(view.q("buddy-draft-gate")!.textContent).toBe("Show all first. Confirm runs every line.");
      expect(confirm.getAttribute("aria-describedby")).toBe(view.q("buddy-draft-gate")!.id);
      await env.click(view.q("buddy-draft-show-all")!);
      expect(view.qa("buddy-draft-item")).toHaveLength(12);
      expect(view.q("buddy-draft")!.textContent).toContain("LAST ONE");
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(false);
      // Folding the list again keeps Confirm open: everything was on screen once.
      await env.click(view.q("buddy-draft-show-all")!);
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(false);
      await env.click(view.q("buddy-draft-confirm")!);
      expect(view.calls.confirmed).toEqual(["d1"]);
    } finally {
      await view.cleanup();
    }
  });

  test("a long value shows its start, and its end only after Show all; nothing is cut silently", async () => {
    const long = `${"x".repeat(300)}THE END`;
    const view = await renderPanel({ state: withDraft, drafts: [{ ...DRAFT, fields: [{ key: "notes", label: "Notes", value: long }] }] });
    try {
      expect(view.q("buddy-draft-value")!.textContent).not.toContain("THE END");
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(true);
      await env.click(view.q("buddy-draft-show-all")!);
      expect(view.q("buddy-draft-value")!.textContent).toBe(long);
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(false);
    } finally {
      await view.cleanup();
    }
  });

  test("a short draft needs no Show all; Confirm is open at once", async () => {
    const view = await renderPanel({ state: withDraft, drafts: [DRAFT] });
    try {
      expect(view.q("buddy-draft-show-all")).toBeNull();
      expect(view.q("buddy-draft-gate")).toBeNull();
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(false);
    } finally {
      await view.cleanup();
    }
  });

  test("the card says where the draft was made: the chat, somewhere else (with a warning), or nothing when unknown", async () => {
    const view = await renderPanel({
      state: withDraft,
      drafts: [DRAFT, { ...DRAFT, id: "d2", origin: "other" }, { ...DRAFT, id: "d3", origin: null }],
    });
    try {
      const origin = (id: string) => document.querySelector(`[data-draft-id='${id}'] [data-testid='buddy-draft-origin']`);
      expect(origin("d1")!.textContent).toBe("Made in the Buddy chat");
      expect(origin("d2")!.textContent).toBe("Not made in the Buddy chat. Check it before you confirm.");
      expect(origin("d3")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("a confirmed row check shows its progress and Stop where it is driven, and points to the bubble elsewhere", async () => {
    const dry: BuddyDraft = { ...DRAFT, path: "import.runDryRun", kind: "dryRun", status: "confirmed", drive: { kind: "dryRun", candidateId: "c1" } };
    const stopped: string[] = [];
    const view = await renderPanel({
      state: withDraft,
      drafts: [dry],
      decisions: {
        pendingFor: () => null,
        errorFor: () => null,
        confirm: () => {},
        reject: () => {},
        driveFor: () => ({ phase: "running", done: 400, total: 4000 }),
        stopDrive: (d) => void stopped.push(d.id),
      },
    });
    try {
      expect(view.q("buddy-drive")!.textContent).toContain("Checking rows: 400 of 4000");
      await env.click(view.q("buddy-drive-stop")!);
      expect(stopped).toEqual(["d1"]);
    } finally {
      await view.cleanup();
    }
    const elsewhere = await renderPanel({ state: withDraft, drafts: [dry] });
    try {
      expect(elsewhere.q("buddy-drive")!.textContent).toBe("Open Buddy to run the row check.");
      expect(elsewhere.q("buddy-drive-stop")).toBeNull();
    } finally {
      await elsewhere.cleanup();
    }
  });
});

describe("replies and the phone keyboard", () => {
  test("an import review link in a finished reply is a link that steps the panel aside (S7)", async () => {
    const reply = `Done. Open ${window.location.origin}/ingest/review/cand_42.`;
    const state = stateWith(
      { type: "send", turnId: "t1", message: "import this" },
      { type: "event", turnId: "t1", event: { type: "text", delta: reply } },
      { type: "end", turnId: "t1", end: { kind: "done", conversationId: "c1" } },
    );
    const view = await renderPanel({ state });
    try {
      const link = view.q<HTMLAnchorElement>("buddy-reply-link")!;
      expect(link.getAttribute("href")).toBe("/ingest/review/cand_42");
      expect(view.q("buddy-reply")!.textContent).toBe(`Buddy: ${reply}`);
      link.addEventListener("click", (e) => e.preventDefault());
      await env.click(link);
      expect(view.calls.open).toEqual([false]);
    } finally {
      await view.cleanup();
    }
  });

  test("while an answer streams, the same text is not a link yet", async () => {
    const state = stateWith(
      { type: "send", turnId: "t1", message: "import this" },
      { type: "event", turnId: "t1", event: { type: "text", delta: "Open /ingest/review/cand_4" } },
    );
    const view = await renderPanel({ state, busy: true });
    try {
      expect(view.q("buddy-reply-link")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("on a touch screen the box is not focused on open, so the keyboard stays down (N7)", async () => {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query === "(pointer: coarse)", media: query, addEventListener() {}, removeEventListener() {} })) as never;
    const view = await renderPanel();
    try {
      expect(view.dialog()!.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(view.q("buddy-input"));
    } finally {
      await view.cleanup();
      window.matchMedia = before;
    }
  });
});

describe("focus after the panel closes (N8)", () => {
  test("focus left on the page body (Safari after a click) goes back to the launcher", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
      returnFocusTo(button, (fn) => fn());
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  test("focus that already landed on something real stays there", () => {
    const button = document.createElement("button");
    const other = document.createElement("input");
    document.body.append(button, other);
    try {
      other.focus();
      returnFocusTo(button, (fn) => fn());
      expect(document.activeElement).toBe(other);
    } finally {
      button.remove();
      other.remove();
    }
  });
});

describe("failed drafts in the person's words (decision 6)", () => {
  test("a confirm that died part way says to check the screen, in en, hi and gu; an internal failure is not shown raw", async () => {
    const { createI18n } = await import("@orrn/i18n");
    const stale = "orrn could not tell if this went through. Check the screen before you try again.";
    const tEn = createI18n("en").t;
    expect(failureText(tEn, stale)).toBe(stale);
    expect(failureText(tEn, "The change failed.")).toBe("The change did not go through.");
    expect(failureText(tEn, "The input does not fit.")).toBe("This change no longer fits the screen it was made for. Ask Buddy again.");
    expect(failureText(createI18n("hi").t, stale)).toBe("orrn पता नहीं लगा सका कि यह हुआ या नहीं। दोबारा करने से पहले स्क्रीन पर देख लें।");
    expect(failureText(createI18n("gu").t, stale)).toBe("orrn જાણી ન શક્યું કે આ થયું કે નહીં. ફરી કરતાં પહેલાં સ્ક્રીન પર જોઈ લો.");
  });
});
