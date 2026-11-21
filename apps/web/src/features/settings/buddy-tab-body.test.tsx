import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@orrn/i18n";

import { installDom, settle } from "@/features/buddy/test-dom";
import type { BuddyDraft } from "@/features/buddy/types";
import { testMe } from "@/shell/palette/test-me";
import { trpc } from "@/shared/utils/trpc";

import type { BuddyCall, BuddyStatus, BuddyTabBodyProps } from "./buddy-tab-body";
import { sectionVisible } from "./model";

const env = installDom("http://localhost/settings?tab=buddy");
beforeAll(() => env.install());
afterAll(() => env.uninstall());

const loaded = <T,>(data: T) => ({ isPending: false, isError: false, data, refetch: () => {} });

const CONNECTED: BuddyStatus = {
  available: true,
  listed: true,
  connected: { grantId: "g1", createdAt: "2026-11-20T04:00:00Z", lastUsedAt: "2026-11-20T05:30:00Z", expiresAt: null },
};
const CALLS: BuddyCall[] = [
  { id: "k1", tool: "orrn_call", path: "stock.summary", outcome: "ok", ms: 42, platform: "api_server", at: "2026-11-20T05:30:00Z" },
  { id: "k2", tool: "orrn_call", path: "orders.create", outcome: "needs_confirm", ms: 18, platform: "telegram", at: "2026-11-20T05:31:00Z" },
  { id: "k3", tool: "chat", path: null, outcome: "pending", ms: 0, platform: null, at: "2026-11-20T05:32:00Z" },
];
const DRAFT: BuddyDraft = {
  id: "d1",
  path: "ingest.answer.set",
  kind: "procedure",
  title: "Answer an import question",
  fields: [{ key: "answer", label: "Answer", value: "Column C is the weight" }],
  items: null,
  status: "pending",
  createdAt: "2026-11-20T05:31:00Z",
  expiresAt: "2026-11-21T05:31:00Z",
  result: null,
  failure: null,
  link: "/ingest/review/cand_1",
  origin: "chat",
  decidedVia: null,
  drive: null,
};

type Calls = { connect: number; revoke: string[]; done: number; copied: string[]; confirmed: string[]; renew: string[]; signIn: number };

async function renderTab(overrides: Partial<BuddyTabBodyProps> = {}, role: "owner" | "viewer" = "owner", locale: "en" | "hi" | "gu" = "en") {
  const { BuddyTabBody } = await import("./buddy-tab-body");
  const calls: Calls = { connect: 0, revoke: [], done: 0, copied: [], confirmed: [], renew: [], signIn: 0 };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, testMe(role) as never);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  function Harness() {
    const [token, setToken] = useState<string | null>(overrides.token ?? null);
    return (
      <BuddyTabBody
        status={loaded(CONNECTED)}
        calls={loaded(CALLS)}
        drafts={loaded([DRAFT])}
        decisions={{ pendingFor: () => null, errorFor: () => null, confirm: (d) => void calls.confirmed.push(d.id), reject: () => {} }}
        when={(at) => new Date(at).toISOString().slice(0, 16).replace("T", " ")}
        connect={() => {
          calls.connect++;
          setToken("orrn_bg_synthetic_0123456789");
        }}
        connecting={false}
        connectError={null}
        revoke={(id) => void calls.revoke.push(id)}
        revoking={false}
        renew={(id) => void calls.renew.push(id)}
        renewing={false}
        renewError={null}
        freshSignIn={false}
        signInAgain={() => void calls.signIn++}
        copy={async (text) => {
          calls.copied.push(text);
          return true;
        }}
        {...overrides}
        token={token}
        onTokenDone={() => {
          calls.done++;
          setToken(null);
        }}
      />
    );
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <I18nProvider locale={locale}>
          <Harness />
        </I18nProvider>
      </QueryClientProvider>,
    );
  });
  const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid='${id}']`);
  const cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  };
  return { calls, q, cleanup };
}

describe("Settings > Buddy", () => {
  test("a plant that is not listed is told Buddy is not set up, and nothing else", async () => {
    const view = await renderTab({ status: loaded({ available: true, listed: false, connected: null }) });
    try {
      expect(view.q("buddy-not-listed")?.textContent).toBe("Buddy is not set up for this plant.");
      expect(view.q("buddy-connect")).toBeNull();
      expect(view.q("buddy-calls")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("not connected: Connect Hermes shows the key once, with the warning, Copy and Done", async () => {
    const view = await renderTab({ status: loaded({ available: true, listed: true, connected: null }) });
    try {
      expect(view.q("buddy-connection")?.textContent).toContain("Hermes is not connected.");
      await env.click(view.q("buddy-connect")!);
      expect(view.calls.connect).toBe(1);
      expect(view.q<HTMLInputElement>("buddy-key-value")?.value).toBe("orrn_bg_synthetic_0123456789");
      expect(view.q<HTMLInputElement>("buddy-key-value")?.readOnly).toBe(true);
      expect(view.q("buddy-key-once")?.textContent).toBe("This key is shown only once. Copy it now and keep it safe. orrn cannot show it again.");
      expect(view.q("buddy-connect")).toBeNull();
      await env.click(view.q("buddy-key-copy")!);
      await settle();
      expect(view.calls.copied).toEqual(["orrn_bg_synthetic_0123456789"]);
      expect(view.q("buddy-key-copied")?.textContent).toBe("Key copied");
      await env.click(view.q("buddy-key-done")!);
      expect(view.calls.done).toBe(1);
      expect(view.q("buddy-key")).toBeNull();
      expect(document.body.textContent).not.toContain("orrn_bg_synthetic");
    } finally {
      await view.cleanup();
    }
  });

  test("a refused copy says to copy by hand", async () => {
    const view = await renderTab({ token: "orrn_bg_synthetic", copy: async () => false });
    try {
      await env.click(view.q("buddy-key-copy")!);
      await settle();
      expect(view.q("buddy-key-copied")?.textContent).toBe("Could not copy. Select the key and copy it by hand.");
    } finally {
      await view.cleanup();
    }
  });

  test("connected: when it was last used, and Disconnect asks first, then revokes that grant", async () => {
    const view = await renderTab();
    try {
      expect(view.q("buddy-last-used")?.textContent).toBe("Last used 2026-11-20 05:30");
      await env.click(view.q("buddy-revoke")!);
      await settle();
      expect(document.querySelector("[role='dialog']")?.textContent).toContain("Disconnect Hermes?");
      expect(view.calls.revoke).toEqual([]);
      await env.click(view.q("buddy-revoke-confirm")!);
      expect(view.calls.revoke).toEqual(["g1"]);
    } finally {
      await view.cleanup();
    }
  });

  test("a grant never used says so", async () => {
    const view = await renderTab({ status: loaded({ ...CONNECTED, connected: { ...CONNECTED.connected!, lastUsedAt: null } }) });
    try {
      expect(view.q("buddy-last-used")?.textContent).toBe("Not used yet");
    } finally {
      await view.cleanup();
    }
  });

  test("the calls list says each outcome in words and where it came from", async () => {
    const view = await renderTab();
    try {
      const rows = Array.from(document.querySelectorAll("[data-testid='buddy-call']")).map((r) => r.textContent ?? "");
      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain("stock.summary");
      expect(rows[0]).toContain("Done");
      expect(rows[0]).toContain("42 ms");
      expect(rows[0]).toContain("orrn chat");
      expect(rows[1]).toContain("Waits for Confirm");
      expect(rows[1]).toContain("Telegram");
      // A reserved call that is still running (fix round schema) has its own word, not the raw outcome.
      expect(rows[2]).toContain("Running");
    } finally {
      await view.cleanup();
    }
  });

  test("empty lists say so", async () => {
    const view = await renderTab({ calls: loaded([]), drafts: loaded([]) });
    try {
      expect(view.q("buddy-calls")?.textContent).toContain("Hermes has not called orrn yet.");
      expect(view.q("buddy-drafts")?.textContent).toContain("No changes from Buddy yet.");
    } finally {
      await view.cleanup();
    }
  });

  test("pending drafts carry Confirm and the review link", async () => {
    const view = await renderTab();
    try {
      expect(view.q<HTMLAnchorElement>("buddy-draft-review")?.getAttribute("href")).toBe("/ingest/review/cand_1");
      await env.click(view.q("buddy-draft-confirm")!);
      expect(view.calls.confirmed).toEqual(["d1"]);
    } finally {
      await view.cleanup();
    }
  });

  test("Buddy not switched on in this orrn: a note, the rest still shows", async () => {
    const view = await renderTab({ status: loaded({ ...CONNECTED, available: false }) });
    try {
      expect(view.q("buddy-not-available")?.textContent).toBe("Buddy is not switched on in this orrn yet. Ask the orrn team.");
      expect(view.q("buddy-connection")).not.toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("a failed load offers Try again", async () => {
    let retried = 0;
    const view = await renderTab({ status: { isPending: false, isError: true, data: undefined, refetch: () => void retried++ } });
    try {
      expect(document.body.textContent).toContain("Could not load Buddy.");
      const retry = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
      await env.click(retry);
      expect(retried).toBe(1);
    } finally {
      await view.cleanup();
    }
  });

  test("Hindi and Gujarati: the tab speaks the language", async () => {
    const hi = await renderTab({ status: loaded({ available: true, listed: false, connected: null }) }, "owner", "hi");
    try {
      expect(hi.q("buddy-not-listed")?.textContent).toBe("इस प्लांट के लिए Buddy सेट नहीं है।");
    } finally {
      await hi.cleanup();
    }
    const gu = await renderTab({ status: loaded({ available: true, listed: false, connected: null }) }, "owner", "gu");
    try {
      expect(gu.q("buddy-not-listed")?.textContent).toBe("આ પ્લાન્ટ માટે Buddy સેટ નથી.");
    } finally {
      await gu.cleanup();
    }
  });
});

describe("Settings > Buddy: renew and a fresh sign-in (fix round decision 5)", () => {
  test("connected: Renew asks for 30 more days on that grant; when it was renewed and when it ends show", async () => {
    const view = await renderTab({
      status: loaded({ ...CONNECTED, connected: { ...CONNECTED.connected!, expiresAt: "2026-12-20T04:00:00Z", renewedAt: "2026-11-20T04:00:00Z" } }),
    });
    try {
      expect(view.q("buddy-renew")?.textContent).toBe("Renew for 30 days");
      expect(view.q("buddy-renewed-on")?.textContent).toBe("Renewed 2026-11-20 04:00");
      expect(view.q("buddy-ends-on")?.textContent).toBe("Ends 2026-12-20 04:00");
      await env.click(view.q("buddy-renew")!);
      expect(view.calls.renew).toEqual(["g1"]);
    } finally {
      await view.cleanup();
    }
  });

  test("refused for want of a fresh sign-in: it says sign in again, plainly, with a button that does it", async () => {
    const view = await renderTab({ freshSignIn: true });
    try {
      expect(view.q("buddy-fresh-sign-in")?.textContent).toContain("Sign in again first.");
      await env.click(view.q("buddy-sign-in-again")!);
      expect(view.calls.signIn).toBe(1);
    } finally {
      await view.cleanup();
    }
  });

  test("a renew that failed for another reason says so", async () => {
    const view = await renderTab({ renewError: "Could not renew. Try again." });
    try {
      expect(view.q("buddy-connection")!.querySelector("[role='alert']")?.textContent).toBe("Could not renew. Try again.");
      expect(view.q("buddy-fresh-sign-in")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });

  test("a non-owner gets no Renew", async () => {
    const view = await renderTab({}, "viewer");
    try {
      expect(view.q("buddy-renew")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });
});

describe("who sees the Buddy tab", () => {
  test("owners only, and not while a Godseye admin impersonates the plant", async () => {
    // Imported here, after the DOM is installed: Radix picks its layout effect when its module first loads.
    const { SETTINGS_SECTIONS } = await import("./sections");
    const section = SETTINGS_SECTIONS.find((s) => s.id === "buddy")!;
    expect(section).toBeDefined();
    expect(sectionVisible(section, testMe("owner"))).toBe(true);
    for (const role of ["admin", "manager", "office", "viewer"] as const) expect(sectionVisible(section, testMe(role))).toBe(false);
    expect(sectionVisible(section, testMe("owner", { impersonating: true }))).toBe(false);
  });

  test("a non-owner never gets Connect or Disconnect, even if the body rendered", async () => {
    const view = await renderTab({ status: loaded({ available: true, listed: true, connected: null }) }, "viewer");
    try {
      expect(view.q("buddy-connect")).toBeNull();
    } finally {
      await view.cleanup();
    }
    const view2 = await renderTab({}, "viewer");
    try {
      expect(view2.q("buddy-revoke")).toBeNull();
      expect(view2.q("buddy-draft-confirm")).toBeNull();
    } finally {
      await view2.cleanup();
    }
  });
});
