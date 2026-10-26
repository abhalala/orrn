import { describe, expect, test } from "bun:test";

import { afterConflict, createOutboxStore, drop, enqueue, flushOutbox, isBlocked, nextToSend, outboxCounts, outboxKey, parseOutbox, queuedReason, type Outbox, type OutboxItem } from "./outbox";

const item = (id: string, runId: string, kind: OutboxItem["kind"], input: Record<string, unknown> = {}): OutboxItem => ({ id, runId, runNumber: null, kind, input: { id: runId, ...input }, queuedAt: 1, conflict: null });

describe("press station outbox (FP-PR-19)", () => {
  test("queue keeps order; the same tap twice is one write; a newer row save replaces the waiting one", () => {
    let box: Outbox = [];
    box = enqueue(box, item("k-start", "r1", "start", { clientMutationId: "k-start" }));
    box = enqueue(box, item("k-start", "r1", "start", { clientMutationId: "k-start" }));
    box = enqueue(box, item("q1", "r1", "billets", { rows: [1] }));
    box = enqueue(box, item("k-stop", "r1", "stop", { clientMutationId: "k-stop" }));
    box = enqueue(box, item("q2", "r1", "billets", { rows: [1, 2] }));
    expect(box.map((i) => i.id)).toEqual(["k-start", "q2", "k-stop"]);
    expect(box[1]!.input.rows).toEqual([1, 2]);
    expect(outboxCounts(box)).toEqual({ waiting: 3, conflicts: 0 });
  });

  test("resend in order with the SAME keys; offline stops and keeps the rest", async () => {
    const box: Outbox = [item("k1", "r1", "start", { clientMutationId: "k1" }), item("k2", "r1", "stop", { clientMutationId: "k2" }), item("k3", "r1", "count", { clientMutationId: "k3" })];
    const seen: string[] = [];
    let online = 2;
    const out = await flushOutbox(
      box,
      async (i) => {
        if (online-- <= 0) throw new TypeError("Failed to fetch");
        seen.push(`${i.kind}:${String(i.input.clientMutationId)}`);
      },
      (e) => e instanceof TypeError,
      () => "refused",
    );
    expect(seen).toEqual(["start:k1", "stop:k2"]);
    expect(out).toMatchObject({ sent: 2, offline: true });
    expect(out.box.map((i) => i.id)).toEqual(["k3"]);
    // Back online: the same key goes out.
    const again = await flushOutbox(out.box, async (i) => void seen.push(`${i.kind}:${String(i.input.clientMutationId)}`), () => false, () => "x");
    expect(seen.at(-1)).toBe("count:k3");
    expect(again.box).toEqual([]);
  });

  test("a refusal is a conflict on that item; later writes of that run wait, other runs go", async () => {
    const box: Outbox = [item("a1", "r1", "start"), item("a2", "r1", "stop"), item("b1", "r2", "start")];
    const sent: string[] = [];
    const out = await flushOutbox(
      box,
      async (i) => {
        if (i.id === "a1") throw new Error("CONFLICT");
        sent.push(i.id);
      },
      () => false,
      () => "This run already started on another tablet.",
    );
    expect(sent).toEqual(["b1"]);
    expect(out.box.map((i) => [i.id, i.conflict])).toEqual([
      ["a1", "This run already started on another tablet."],
      ["a2", null],
    ]);
    expect(nextToSend(out.box)).toBeNull();
    expect(outboxCounts(out.box, "r1")).toEqual({ waiting: 1, conflicts: 1 });
    // Dropping the conflict lets the rest of that run go.
    expect(nextToSend(drop(out.box, "a1"))?.id).toBe("a2");
  });

  test("a full-replace save never replaces one that is in conflict", () => {
    let box: Outbox = afterConflict([item("q1", "r1", "lines")], "q1", "no");
    box = enqueue(box, item("q2", "r1", "lines"));
    expect(box.map((i) => i.id)).toEqual(["q1", "q2"]);
  });

  test("storage: persisted per plant, malformed text ignored, storage errors swallowed", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const s = createOutboxStore("orrn.press.outbox.c1", storage);
    let calls = 0;
    s.subscribe(() => (calls += 1));
    s.set([item("k1", "r1", "start")]);
    expect(createOutboxStore("orrn.press.outbox.c1", storage).get().map((i) => i.id)).toEqual(["k1"]);
    s.set([]);
    expect(mem.has("orrn.press.outbox.c1")).toBe(false);
    expect(calls).toBe(2);
    expect(parseOutbox("{nope")).toEqual([]);
    expect(parseOutbox(JSON.stringify([{ id: 1 }, { id: "x", runId: "r", kind: "hack", input: {} }]))).toEqual([]);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    const b = createOutboxStore("k", broken);
    b.set([item("k1", "r1", "start")]);
    expect(b.get()).toHaveLength(1);
  });
});

describe("outbox per plant and per person (FP-PR-19 review I-1)", () => {
  const memStorage = () => {
    const mem = new Map<string, string>();
    return { mem, storage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } };
  };

  test("the key names the plant AND the person; B at the same tablet never sees A's list", () => {
    expect(outboxKey("c1", "u1")).toBe("orrn.press.outbox.c1.u1");
    const { storage } = memStorage();
    const a = createOutboxStore(outboxKey("c1", "userA"), storage);
    a.set([item("k1", "r1", "start", { clientMutationId: "k1" })]);
    const b = createOutboxStore(outboxKey("c1", "userB"), storage);
    expect(b.get()).toEqual([]);
    expect(nextToSend(b.get())).toBeNull();
    // Same person, another plant: also apart.
    expect(createOutboxStore(outboxKey("c2", "userA"), storage).get()).toEqual([]);
    // A signs back in: the list is there, key and all.
    expect(createOutboxStore(outboxKey("c1", "userA"), storage).get().map((i) => i.id)).toEqual(["k1"]);
  });

  test("a flush told to stop sends nothing more; a send aborted in flight stays waiting, not a conflict", async () => {
    const box: Outbox = [item("k1", "r1", "start"), item("k2", "r1", "stop")];
    let stop = false;
    const sent: string[] = [];
    const out = await flushOutbox(
      box,
      async (i) => {
        sent.push(i.id);
        // The plant is switched while k1 is on the wire: the request is aborted.
        stop = true;
        throw new DOMException("aborted", "AbortError");
      },
      () => false,
      () => "refused",
      () => {},
      () => stop,
    );
    expect(sent).toEqual(["k1"]);
    expect(out).toMatchObject({ sent: 0, offline: false, stopped: true });
    expect(out.box.map((i) => [i.id, i.conflict])).toEqual([["k1", null], ["k2", null]]);
    // Told to stop before the first send: nothing leaves.
    const none = await flushOutbox(box, async (i) => void sent.push(`never-${i.id}`), () => false, () => "x", () => {}, () => true);
    expect(sent).toEqual(["k1"]);
    expect(none).toMatchObject({ sent: 0, stopped: true });
  });

  test("a second tab's change is picked up (reload), and only when the text changed", () => {
    const { storage } = memStorage();
    const key = outboxKey("c1", "u1");
    const tab1 = createOutboxStore(key, storage);
    const tab2 = createOutboxStore(key, storage);
    let calls = 0;
    tab1.subscribe(() => (calls += 1));
    tab2.set([item("k1", "r1", "start")]);
    expect(tab1.get()).toEqual([]);
    tab1.reload();
    expect(tab1.get().map((i) => i.id)).toEqual(["k1"]);
    expect(calls).toBe(1);
    tab1.reload();
    expect(calls).toBe(1);
  });

  test("why a write queued: offline, or behind a refused change of its own run", () => {
    const refused = afterConflict([item("a1", "r1", "start"), item("a2", "r1", "stop")], "a1", "no");
    expect(isBlocked(refused)).toBe(true);
    expect(isBlocked([item("a2", "r1", "stop")])).toBe(false);
    expect(isBlocked([])).toBe(false);
    expect(queuedReason(refused, "r1", false)).toBe("refused");
    expect(queuedReason(refused, "r2", false)).toBe("saved");
    expect(queuedReason(refused, "r1", true)).toBe("saved");
    expect(queuedReason([], "r1", true)).toBe("saved");
  });
});

describe("offline log run and the notes (FP-PR-19)", () => {
  test("only remarks or a reading the server lacks block an offline log", async () => {
    const { unsentNotes } = await import("./outbox");
    const run = { pressRemark: "Die ran hot", dieRemark: null };
    expect(unsentNotes({ pressRemark: "Die ran hot", dieRemark: "", readingText: "" }, { run })).toBe(false);
    expect(unsentNotes({ pressRemark: "Die ran hot ", dieRemark: "", readingText: "" }, { run })).toBe(false);
    expect(unsentNotes({ pressRemark: "Die ran hotter", dieRemark: "", readingText: "" }, { run })).toBe(true);
    expect(unsentNotes({ pressRemark: "", dieRemark: "Bearing marks", readingText: "" }, { run })).toBe(true);
    expect(unsentNotes({ pressRemark: "", dieRemark: "", readingText: "12.4" }, { run })).toBe(true);
  });
});
