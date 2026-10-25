/**
 * M2 (final explore): sign out while offline did nothing and said nothing; the session stayed on a
 * shared tablet while the outbox toast implied it had ended.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { outboxKey, type OutboxItem } from "../../features/press/outbox";
import { flushLease, registerLeaveWarning, resetOutboxSessionForTests, setActiveSession, storeFor } from "../../features/press/outbox-session";
import { SIGN_OUT_REFUSAL, signOutAndResetWith, type SignOutDeps } from "./sign-out-core";

const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const item = (id: string): OutboxItem => ({ id, runId: "r1", runNumber: "PR-1", kind: "start", input: { id: "r1", clientMutationId: id }, queuedAt: 1, conflict: null });

afterEach(() => {
  mem.clear();
  resetOutboxSessionForTests();
});

function deps(mode: "ok" | "refused" | "throws") {
  const calls: string[] = [];
  const d: SignOutDeps = {
    async endSession(onSuccess) {
      calls.push("endSession");
      if (mode === "throws") throw new TypeError("Failed to fetch");
      if (mode === "ok") onSuccess();
      return { error: mode === "refused" ? { status: 0 } : null };
    },
    clearCache: () => void calls.push("clearCache"),
  };
  return { d, calls };
}

describe("sign out (M2)", () => {
  test("offline: nothing is ended or cleared, the result says offline, and the waiting press changes are counted without promising a sign-in", async () => {
    resetOutboxSessionForTests(storage);
    setActiveSession({ companyId: "c1", userId: "packer" });
    storeFor("c1", "packer").set([item("k1")]);
    const warned: [number, string][] = [];
    registerLeaveWarning((n, why) => void warned.push([n, why]));
    const { d, calls } = deps("ok");
    let done = 0;
    const result = await signOutAndResetWith(() => void (done += 1), () => false, d);
    expect(result).toBe("offline");
    expect(calls).toEqual([]);
    expect(done).toBe(0);
    expect(warned).toEqual([[1, "offline"]]);
    // The person is still in: their list keeps its lease and stays theirs.
    expect(flushLease("c1", "packer")).not.toBeNull();
    expect(mem.has(outboxKey("c1", "packer"))).toBe(true);
    const en = createI18n("en");
    expect(en.t(SIGN_OUT_REFUSAL.offline)).toBe("You are offline; sign-out needs a connection. You are still signed in.");
    expect(en.t("press.console.outbox.offlineLeft", { count: 1 })).toBe("1 change not sent yet. They stay saved on this tablet and go out when the connection is back.");
    for (const locale of ["hi", "gu"] as const) {
      expect(createI18n(locale).t(SIGN_OUT_REFUSAL.offline)).not.toBe(en.t(SIGN_OUT_REFUSAL.offline));
      expect(createI18n(locale).t(SIGN_OUT_REFUSAL.failed)).not.toBe(en.t(SIGN_OUT_REFUSAL.failed));
    }
  });

  test("online: the session ends, the cache is cleared, then the screen leaves", async () => {
    resetOutboxSessionForTests(storage);
    const { d, calls } = deps("ok");
    let done = 0;
    expect(await signOutAndResetWith(() => void (done += 1), () => true, d)).toBe("signed_out");
    expect(calls).toEqual(["endSession", "clearCache"]);
    expect(done).toBe(1);
  });

  test("the link drops mid-way (fetch throws) or the server refuses: 'failed', the same person carries on", async () => {
    for (const mode of ["throws", "refused"] as const) {
      resetOutboxSessionForTests(storage);
      setActiveSession({ companyId: "c1", userId: "packer" });
      const { d } = deps(mode);
      let done = 0;
      expect(await signOutAndResetWith(() => void (done += 1), () => true, d)).toBe("failed");
      expect(done).toBe(0);
      // cancelSessionChange ran: the person's list may be sent again.
      expect(flushLease("c1", "packer")).not.toBeNull();
    }
  });
});
