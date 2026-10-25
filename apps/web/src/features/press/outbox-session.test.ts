import { afterEach, describe, expect, test } from "bun:test";

import { outboxKey, type OutboxItem } from "./outbox";
import {
  beginSessionChange,
  cancelSessionChange,
  flushLease,
  registerLeaveWarning,
  resetOutboxSessionForTests,
  setActiveSession,
  storeFor,
  waitingToLeave,
  warnLeaving,
} from "./outbox-session";

const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const item = (id: string): OutboxItem => ({ id, runId: "r1", runNumber: "PR-1", kind: "start", input: { id: "r1", clientMutationId: id }, queuedAt: 1, conflict: null });

afterEach(() => {
  mem.clear();
  resetOutboxSessionForTests();
});

describe("press outbox session (review I-1)", () => {
  test("stores are per plant and person; A's waiting list is not B's", () => {
    resetOutboxSessionForTests(storage);
    storeFor("c1", "A").set([item("k1")]);
    expect(mem.has(outboxKey("c1", "A"))).toBe(true);
    expect(storeFor("c1", "B").get()).toEqual([]);
    expect(storeFor("c1", "A")).toBe(storeFor("c1", "A"));
  });

  test("a flush lease exists only for the signed-in person and plant of that list", () => {
    resetOutboxSessionForTests(storage);
    expect(flushLease("c1", "A")).toBeNull();
    setActiveSession({ companyId: "c1", userId: "B" });
    expect(flushLease("c1", "A")).toBeNull();
    setActiveSession({ companyId: "c1", userId: "A" });
    const lease = flushLease("c1", "A")!;
    expect(lease.alive()).toBe(true);
    // B signs in over A: the lease A held dies, and A's list has no lease while B is in.
    setActiveSession({ companyId: "c1", userId: "B" });
    expect(lease.alive()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    expect(flushLease("c1", "A")).toBeNull();
  });

  test("a plant switch aborts the send in flight and blocks new ones until the new plant is known", () => {
    resetOutboxSessionForTests(storage);
    setActiveSession({ companyId: "c1", userId: "A" });
    const lease = flushLease("c1", "A")!;
    beginSessionChange();
    expect(lease.signal.aborted).toBe(true);
    expect(lease.alive()).toBe(false);
    // While company.switch is on the wire the old plant's list may not go (the server would answer in the new plant).
    expect(flushLease("c1", "A")).toBeNull();
    setActiveSession({ companyId: "c2", userId: "A" });
    expect(flushLease("c1", "A")).toBeNull();
    expect(flushLease("c2", "A")?.alive()).toBe(true);
  });

  test("a switch that failed gives the same plant its lease back", () => {
    resetOutboxSessionForTests(storage);
    setActiveSession({ companyId: "c1", userId: "A" });
    beginSessionChange();
    expect(flushLease("c1", "A")).toBeNull();
    cancelSessionChange();
    expect(flushLease("c1", "A")?.alive()).toBe(true);
  });

  test("leaving warns with the count of what is waiting, and keeps it", () => {
    resetOutboxSessionForTests(storage);
    const warned: [number, string][] = [];
    const off = registerLeaveWarning((n, why) => warned.push([n, why]));
    expect(warnLeaving("signOut")).toBe(0);
    setActiveSession({ companyId: "c1", userId: "A" });
    expect(warnLeaving("signOut")).toBe(0);
    storeFor("c1", "A").set([item("k1"), item("k2")]);
    expect(waitingToLeave()).toBe(2);
    expect(warnLeaving("signOut")).toBe(2);
    expect(warnLeaving("plant")).toBe(2);
    expect(warned).toEqual([[2, "signOut"], [2, "plant"]]);
    // Still there for A's next sign-in.
    expect(storeFor("c1", "A").get()).toHaveLength(2);
    off();
    warnLeaving("signOut");
    expect(warned).toHaveLength(2);
  });
});
