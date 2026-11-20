import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import { testMe } from "@/shell/palette/test-me";
import { trpc } from "@/shared/utils/trpc";

import { showBuddy } from "./buddy-launcher";
import { chatReducer, initialChat, type ChatState } from "./chat-model";
import { reviewPath } from "./draft-card";
import type { BuddyPanelBodyProps, DraftDecisions } from "./panel-body";
import { installDom, settle, typeInto } from "./test-dom";
import type { BuddyDraft } from "./types";

const env = installDom();
beforeAll(() => env.install());
afterAll(() => env.uninstall());

const DRAFT: BuddyDraft = {
  id: "d1",
  path: "orders.create",
  title: "New order for KD Traders",
  lines: [
    { label: "Customer", value: "KD Traders" },
    { label: "Section", value: "12170, 500 kg" },
  ],
  status: "pending",
  createdAt: "2026-11-20T06:00:00Z",
  expiresAt: "2026-11-21T06:00:00Z",
  result: null,
  failure: null,
  link: null,
};

type Calls = { sent: string[]; retried: string[]; newChat: number; open: boolean[]; confirmed: string[]; rejected: string[] };

function stateWith(...steps: Parameters<typeof chatReducer>[1][]): ChatState {
  return steps.reduce(chatReducer, initialChat("c1"));
}

async function renderPanel(
  props: Partial<Omit<BuddyPanelBodyProps, "chat">> & { state?: ChatState; busy?: boolean; role?: "owner" | "viewer"; locale?: "en" | "hi" } = {},
) {
  const { BuddyPanelBody } = await import("./panel-body");
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
  };
  return { calls, dialog, q, qa, opener, cleanup };
}

describe("the Buddy panel is a real dialog", () => {
  test("role dialog, aria-modal, named by its Buddy heading", async () => {
    const view = await renderPanel();
    try {
      const dialog = view.dialog()!;
      expect(dialog).not.toBeNull();
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      const labelledBy = dialog.getAttribute("aria-labelledby")!;
      expect(document.getElementById(labelledBy)?.textContent).toBe("Buddy");
      expect(view.q("buddy-new-chat")?.textContent).toContain("New chat");
      expect(dialog.querySelector("textarea")?.getAttribute("aria-label")).toBe("Message to Buddy");
    } finally {
      await view.cleanup();
    }
  });

  test("focus moves into the dialog and Tab is trapped inside it", async () => {
    const view = await renderPanel();
    try {
      const dialog = view.dialog()!;
      expect(dialog.contains(document.activeElement)).toBe(true);
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
