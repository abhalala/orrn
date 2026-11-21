import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createI18n, I18nProvider } from "@orrn/i18n";
import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";

import { testMe } from "@/shell/palette/test-me";
import { trpc } from "@/shared/utils/trpc";

import { DraftCard, failureText, fieldLabel, isConfirmBlocked, type DriveView } from "./draft-card";
import { FIELD_WORD_KEYS } from "./draft-card-fields";
import { CARD_INPUT_KEYS } from "./draft-card.input-keys";
import { installDom, settle } from "./test-dom";
import type { BuddyDraft, DraftField } from "./types";

const env = installDom();
beforeAll(() => env.install());
afterAll(() => env.uninstall());

const field = (key: string, value: string, extra: Partial<DraftField> = {}): DraftField => ({
  key,
  label: key,
  value,
  ref: null,
  marked: false,
  ...extra,
});

const BASE: BuddyDraft = {
  id: "d_synth_1",
  path: "vendor.merge",
  kind: "procedure",
  title: "Merge vendors",
  fields: [],
  items: null,
  status: "pending",
  createdAt: "2026-11-21T06:00:00Z",
  expiresAt: "2026-11-22T06:00:00Z",
  result: null,
  failure: null,
  link: null,
  origin: "chat",
  decidedVia: null,
  drive: null,
  irreversible: true,
  confirmBlock: null,
};

async function renderCard(draft: BuddyDraft, opts: { locale?: "en" | "hi" | "gu"; drive?: DriveView | null } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, { ...testMe("owner"), buddy: true } as never);
  const calls = { confirmed: 0, rejected: 0 };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <I18nProvider locale={opts.locale ?? "en"}>
          <DraftCard
            draft={draft}
            when={(at) => new Date(at).toISOString().slice(0, 16)}
            onConfirm={() => void calls.confirmed++}
            onReject={() => void calls.rejected++}
            drive={opts.drive ?? null}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  const q = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`[data-testid='${id}']`);
  const qa = (id: string) => Array.from(host.querySelectorAll<HTMLElement>(`[data-testid='${id}']`));
  return {
    host,
    q,
    qa,
    calls,
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("every input key on a draft card has a word in en, hi and gu (S4, decision 5)", () => {
  // CARD_INPUT_KEYS is generated from the server registry by packages/server/test/card-input-keys.test.ts, which also
  // fails when an allowed mutation gains a key the list does not hold.
  const enField = en.buddy.field as Record<string, string>;
  const hiField = hi.buddy.field as Record<string, string>;
  const guField = gu.buddy.field as Record<string, string>;

  test("each top-level key of each allowed mutation has its own word in all three languages", () => {
    expect(CARD_INPUT_KEYS.length).toBeGreaterThan(200);
    const missing = CARD_INPUT_KEYS.filter(
      (k) => !Object.hasOwn(enField, k) || !Object.hasOwn(hiField, k) || !Object.hasOwn(guField, k) || !FIELD_WORD_KEYS.has(k),
    );
    expect(missing).toEqual([]);
  });

  test("the card's key set is exactly the keys that have words", () => {
    expect([...FIELD_WORD_KEYS].sort()).toEqual(Object.keys(enField).sort());
    expect(Object.keys(hiField).sort()).toEqual(Object.keys(enField).sort());
    expect(Object.keys(guField).sort()).toEqual(Object.keys(enField).sort());
  });

  test("the label is said in the person's language, never the server's English, for every key", () => {
    for (const locale of ["hi", "gu"] as const) {
      const { t } = createI18n(locale);
      const words = (locale === "hi" ? hiField : guField) as Record<string, string>;
      for (const key of CARD_INPUT_KEYS) {
        expect({ key, label: fieldLabel(t, { key, label: `Server ${key}` }) }).toEqual({ key, label: words[key]! });
      }
    }
  });

  test("a key the card has no word for shows the server's label; a prototype name is not a word", () => {
    const { t } = createI18n("hi");
    expect(fieldLabel(t, { key: "somethingNew", label: "Something new" })).toBe("Something new");
    expect(fieldLabel(t, { key: "constructor", label: "Constructor" })).toBe("Constructor");
    expect(fieldLabel(t, { key: "__proto__", label: "Proto" })).toBe("Proto");
  });
});

describe("ids show as names, and a change that cannot be undone needs every name (S4, decision 5)", () => {
  test("vendor.merge: the card says which vendor is kept and which is merged away", async () => {
    const view = await renderCard({
      ...BASE,
      fields: [
        field("keepId", "Synth Metals A", { ref: { id: "v_synth_A", name: "Synth Metals A" } }),
        field("mergeIds", "Synth Metals B (v_synth_B)"),
      ],
    });
    try {
      const text = view.q("buddy-draft-fields")!.textContent!;
      expect(text).toContain("Keep this one");
      expect(text).toContain("Synth Metals A");
      expect(text).toContain("Merge into it and remove");
      expect(text).toContain("Synth Metals B (v_synth_B)");
      expect(text).not.toContain("v_synth_A");
      expect(view.q("buddy-draft-no-name")).toBeNull();
      expect(view.q("buddy-draft-blocked")).toBeNull();
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(false);
    } finally {
      await view.cleanup();
    }
  });

  test("vendor.merge with a kept id that has no name: the id stays visible, Confirm is off and the card says why", async () => {
    const view = await renderCard({
      ...BASE,
      fields: [field("keepId", "v_synth_X", { ref: { id: "v_synth_X", name: null } }), field("mergeIds", "Synth Metals B (v_synth_B)")],
      confirmBlock: { reason: "unnamed_id", keys: ["keepId"] },
    });
    try {
      expect(view.q("buddy-draft-fields")!.textContent).toContain("v_synth_X");
      expect(view.qa("buddy-draft-no-name").map((n) => n.textContent)).toEqual(["no name found"]);
      const blocked = view.q("buddy-draft-blocked")!;
      expect(blocked.textContent).toBe("orrn found no name for Keep this one, so this change cannot be confirmed here.");
      const confirm = view.q<HTMLButtonElement>("buddy-draft-confirm")!;
      expect(confirm.disabled).toBe(true);
      expect(confirm.getAttribute("aria-describedby")).toBe(blocked.id);
      // Reject stays open.
      const reject = view.q<HTMLButtonElement>("buddy-draft-reject")!;
      expect(reject.disabled).toBe(false);
      await env.click(reject);
      expect(view.calls.rejected).toBe(1);
    } finally {
      await view.cleanup();
    }
  });

  test("customer.delete: the customer's name is shown; with no name Confirm is off, in Hindi and Gujarati too", async () => {
    const named = await renderCard({ ...BASE, path: "customer.delete", title: "Delete a customer", fields: [field("id", "Synth Traders", { ref: { id: "c_synth_1", name: "Synth Traders" } })] });
    try {
      expect(named.q("buddy-draft-fields")!.textContent).toBe("RecordSynth Traders");
      expect(named.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(false);
    } finally {
      await named.cleanup();
    }
    const unnamed: BuddyDraft = {
      ...BASE,
      path: "customer.delete",
      title: "Delete a customer",
      fields: [field("id", "c_synth_9", { ref: { id: "c_synth_9", name: null } })],
      confirmBlock: { reason: "unnamed_id", keys: ["id"] },
    };
    for (const [locale, sentence, note] of [
      ["en", "orrn found no name for Record, so this change cannot be confirmed here.", "no name found"],
      ["hi", "orrn को रिकॉर्ड का नाम नहीं मिला, इसलिए यह बदलाव यहां पक्का नहीं हो सकता।", "नाम नहीं मिला"],
      ["gu", "orrn ને રેકોર્ડ નું નામ ન મળ્યું, એટલે આ ફેરફાર અહીં પાકો ન થઈ શકે.", "નામ ન મળ્યું"],
    ] as const) {
      const view = await renderCard(unnamed, { locale });
      try {
        expect(view.q("buddy-draft-fields")!.textContent).toContain("c_synth_9");
        expect(view.q("buddy-draft-no-name")!.textContent).toBe(note);
        expect(view.q("buddy-draft-blocked")!.textContent).toBe(sentence);
        expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(true);
      } finally {
        await view.cleanup();
      }
    }
  });

  test("an irreversible change with an unnamed id is held even if the server sent no confirmBlock", async () => {
    const view = await renderCard({ ...BASE, path: "customer.delete", fields: [field("id", "c_synth_9", { ref: { id: "c_synth_9", name: null } })] });
    try {
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(true);
      expect(view.q("buddy-draft-blocked")!.textContent).toContain("Record");
    } finally {
      await view.cleanup();
    }
  });

  test("a change that can be undone shows the no-name note but keeps Confirm open", async () => {
    const view = await renderCard({ ...BASE, path: "customer.update", irreversible: false, fields: [field("id", "c_synth_9", { ref: { id: "c_synth_9", name: null } }), field("city", "Rajkot")] });
    try {
      expect(view.q("buddy-draft-no-name")!.textContent).toBe("no name found");
      expect(view.q("buddy-draft-blocked")).toBeNull();
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(false);
    } finally {
      await view.cleanup();
    }
  });

  test("the Show all gate and the block together: Confirm stays off after Show all, and both reasons are named", async () => {
    const view = await renderCard({
      ...BASE,
      path: "customer.delete",
      fields: [field("id", "c_synth_9", { ref: { id: "c_synth_9", name: null } }), field("note", "x".repeat(400))],
      confirmBlock: { reason: "unnamed_id", keys: ["id"] },
    });
    try {
      const confirm = view.q<HTMLButtonElement>("buddy-draft-confirm")!;
      expect(confirm.disabled).toBe(true);
      expect(confirm.getAttribute("aria-describedby")!.split(" ").sort()).toEqual([view.q("buddy-draft-blocked")!.id, view.q("buddy-draft-gate")!.id].sort());
      await env.click(view.q("buddy-draft-show-all")!);
      expect(view.q("buddy-draft-gate")).toBeNull();
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(true);
    } finally {
      await view.cleanup();
    }
  });
});

describe("text direction marks show and hold a destructive Confirm; joiners are never touched (D-L3, decision 10)", () => {
  test("a marked value shows the server's visible markers exactly, with a warning line, and Confirm is off", async () => {
    const value = "Synth⟦U+202E⟧oC";
    const view = await renderCard({
      ...BASE,
      path: "customer.delete",
      fields: [field("id", value, { ref: { id: "c_synth_1", name: value }, marked: true })],
      confirmBlock: { reason: "bidi", keys: ["id"] },
    });
    try {
      expect(view.q("buddy-draft-value")!.textContent).toBe(value);
      expect(view.qa("buddy-draft-marked").map((n) => n.textContent)).toEqual(["Hidden marks that change how text reads are shown as ⟦U+...⟧."]);
      expect(view.q("buddy-draft-blocked")!.textContent).toBe("Record holds hidden marks that change how the text reads, so this change cannot be confirmed here.");
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(true);
    } finally {
      await view.cleanup();
    }
  });

  test("a marked field on a change that can be undone warns but leaves Confirm open", async () => {
    const view = await renderCard({ ...BASE, path: "customer.update", irreversible: false, fields: [field("name", "Synth⟦U+2066⟧Co", { marked: true })] });
    try {
      expect(view.q("buddy-draft-marked")).not.toBeNull();
      expect(view.q<HTMLButtonElement>("buddy-draft-confirm")!.disabled).toBe(false);
    } finally {
      await view.cleanup();
    }
  });

  test("ZWJ and ZWNJ in a Hindi or Gujarati name reach the screen unchanged, with no warning", async () => {
    const hindi = "क्‍ष ट्रेडर्स";
    const gujarati = "શ્‌રી મેટલ્સ";
    const view = await renderCard({ ...BASE, path: "customer.create", irreversible: false, fields: [field("name", hindi), field("notes", gujarati)] });
    try {
      const values = view.qa("buddy-draft-value").map((n) => n.textContent);
      expect(values).toEqual([hindi, gujarati]);
      expect([...values[0]!].map((c) => c.codePointAt(0))).toContain(0x200d);
      expect([...values[1]!].map((c) => c.codePointAt(0))).toContain(0x200c);
      expect(view.q("buddy-draft-marked")).toBeNull();
    } finally {
      await view.cleanup();
    }
  });
});

describe("the row check's last words are the server's stored outcome (S2, decision 3)", () => {
  const dry: BuddyDraft = { ...BASE, path: "import.runDryRun", kind: "dryRun", status: "confirmed", irreversible: false, fields: [field("candidateId", "Orders 2026.xlsx")] };

  test("a discarded table is never shown as done, whatever the bubble last saw", async () => {
    const view = await renderCard({ ...dry, result: { dryRun: { outcome: "failed", state: "discarded" } } }, { drive: { phase: "done", done: 4000, total: 4000 } });
    try {
      const text = view.q("buddy-drive")!.textContent!;
      expect(view.q("buddy-drive")!.dataset.phase).toBe("failed");
      expect(text).not.toContain("Rows checked.");
      expect(text).toContain("The row check stopped with a problem. Open the review page.");
      expect(text).toContain("Sheet now: Discarded");
    } finally {
      await view.cleanup();
    }
  });

  test("a stored done says done with the state word, in Settings too (no bubble drive)", async () => {
    const view = await renderCard({ ...dry, result: { dryRun: { outcome: "done", state: "ready" } } }, { locale: "hi" });
    try {
      expect(view.q("buddy-drive")!.dataset.phase).toBe("done");
      expect(view.q("buddy-drive")!.textContent).toBe("लाइनें जांच ली गईं।शीट अभी: तैयार");
    } finally {
      await view.cleanup();
    }
  });

  test("between the end of the loop and the server's answer the card says it is reading, not done", async () => {
    const view = await renderCard({ ...dry, drive: { kind: "dryRun", candidateId: "cand_synth" } }, { drive: { phase: "reading", done: 4000, total: 4000 } });
    try {
      expect(view.q("buddy-drive")!.textContent).toBe("Reading how the row check ended");
    } finally {
      await view.cleanup();
    }
  });

  test("a report that stored nothing says orrn could not read it", async () => {
    const view = await renderCard(dry, { drive: { phase: "unknown", done: null, total: null } });
    try {
      expect(view.q("buddy-drive")!.textContent).toBe("orrn could not read how the row check ended. Open the review page.");
    } finally {
      await view.cleanup();
    }
  });
});

describe("the new refusals read in the person's language", () => {
  test("the stale sheet failure (S3) is said, not 'unknown'", () => {
    for (const locale of ["en", "hi", "gu"] as const) {
      const { t } = createI18n(locale);
      const text = failureText(t, "The sheet changed after this was drafted. Ask Buddy again.");
      expect(text).not.toBe(t("refusal.unknown"));
      expect(text).toBe(t("refusal.buddyStale"));
    }
  });

  test("the server's CONFIRM_BLOCKED refusal is known by its reason, not its words", () => {
    expect(isConfirmBlocked({ data: { code: "PRECONDITION_FAILED", meta: { reason: "CONFIRM_BLOCKED" } } })).toBe(true);
    expect(isConfirmBlocked({ data: { code: "PRECONDITION_FAILED", meta: { reason: "OTHER" } } })).toBe(false);
    expect(isConfirmBlocked({ data: { code: "PRECONDITION_FAILED" } })).toBe(false);
    expect(isConfirmBlocked(new Error("CONFIRM_BLOCKED"))).toBe(false);
    expect(isConfirmBlocked(null)).toBe(false);
  });
});
