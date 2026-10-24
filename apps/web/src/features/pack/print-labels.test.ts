import { TRPCClientError } from "@trpc/client";
import { describe, expect, test } from "bun:test";

import { createPrintQueue, labelRun, printErrorKey, type PrintItem } from "./print-labels";

const items = (n: number): PrintItem[] =>
  Array.from({ length: n }, (_, i) => ({ bundleId: `b${i + 1}`, serial: `26I40${String(i + 1).padStart(2, "0")}` }));

/** A print function that records calls and fails for the listed bundle ids. */
function fakePrinter(failIds: string[] = []) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const print = async (item: PrintItem) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push(item.bundleId);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    if (failIds.includes(item.bundleId)) throw new Error(`printer offline for ${item.bundleId}`);
  };
  return { print, calls, maxInFlight: () => maxInFlight };
}

describe("createPrintQueue", () => {
  test("prints one label at a time, in order, and reports progress", async () => {
    const p = fakePrinter();
    const q = createPrintQueue(p.print);
    const seen: number[] = [];
    q.subscribe(() => seen.push(q.getState().done));
    const final = await q.run(items(4));
    expect(p.calls).toEqual(["b1", "b2", "b3", "b4"]);
    expect(p.maxInFlight()).toBe(1);
    expect(final).toMatchObject({ status: "done", total: 4, done: 4, failed: [] });
    expect(seen).toContain(2);
    expect(seen.at(-1)).toBe(4);
  });

  test("a failure doesn't stop the rest; failures are listed with the reason", async () => {
    const p = fakePrinter(["b2"]);
    const q = createPrintQueue(p.print);
    const final = await q.run(items(3));
    expect(p.calls).toEqual(["b1", "b2", "b3"]);
    expect(final.done).toBe(3);
    expect(final.failed).toHaveLength(1);
    expect(final.failed[0]).toMatchObject({ bundleId: "b2", serial: "26I4002" });
    expect(final.failed[0]!.error).toBeInstanceOf(Error);
  });

  test("retryFailed prints only the failed labels again", async () => {
    const fails = ["b2", "b3"];
    const calls: string[] = [];
    const q = createPrintQueue(async (item) => {
      calls.push(item.bundleId);
      if (fails.includes(item.bundleId)) throw new Error("offline");
    });
    await q.run(items(3));
    fails.length = 0; // printer back
    calls.length = 0;
    const final = await q.retryFailed();
    expect(calls).toEqual(["b2", "b3"]);
    expect(final).toMatchObject({ status: "done", total: 2, done: 2, failed: [] });
  });

  test("labels asked for while printing join the same run, without duplicates", async () => {
    const p = fakePrinter();
    const q = createPrintQueue(p.print);
    const first = q.run(items(3));
    void q.run([
      { bundleId: "b3", serial: "x" },
      { bundleId: "b9", serial: "26I4009" },
    ]);
    const final = await first;
    expect(p.calls).toEqual(["b1", "b2", "b3", "b9"]);
    expect(final).toMatchObject({ total: 4, done: 4 });
  });

  test("a new run after one finishes starts its own count", async () => {
    const q = createPrintQueue(fakePrinter().print);
    await q.run(items(3));
    const final = await q.run(items(1));
    expect(final).toMatchObject({ total: 1, done: 1 });
  });

  test("an empty run does nothing", async () => {
    const p = fakePrinter();
    const q = createPrintQueue(p.print);
    const final = await q.run([]);
    expect(p.calls).toEqual([]);
    expect(final.status).toBe("idle");
  });
});

describe("printErrorKey (plain words, never the print service's internals)", () => {
  const err = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });

  test("maps server errors to floor messages", () => {
    expect(printErrorKey(err("NOT_FOUND", "Bundle printer profile not found"))).toBe("pack.print.errors.noPrinter");
    expect(printErrorKey(err("NOT_FOUND", "No active spool deployment for this company"))).toBe(
      "pack.print.errors.notSetUp",
    );
    expect(printErrorKey(err("BAD_REQUEST", "Bundle label template is not pushed to spool yet"))).toBe(
      "pack.print.errors.noTemplate",
    );
    expect(printErrorKey(err("BAD_GATEWAY", "Failed to submit bundle label print: ECONNREFUSED"))).toBe(
      "pack.print.errors.offline",
    );
    expect(printErrorKey(err("FORBIDDEN", "Insufficient permissions"))).toBe("pack.print.errors.forbidden");
    expect(printErrorKey(new TypeError("Failed to fetch"))).toBe("pack.print.errors.network");
    expect(printErrorKey("weird")).toBe("pack.print.errors.generic");
  });

  test("a dropped connection reads as no internet, also when the tRPC client wraps the fetch error", () => {
    // httpBatchLink turns a failed fetch into a TRPCClientError and keeps the TypeError as its cause.
    expect(printErrorKey(TRPCClientError.from(new TypeError("Failed to fetch")))).toBe("pack.print.errors.network");
  });
});

describe("labelRun (the labels a session prints, in packing order)", () => {
  const bundle = (serial: string, status = "available") => ({ id: `id-${serial}`, serial, status });

  test("counting order across a digit boundary, not the server's text order", () => {
    // bundle.getGroup sorts serials as text: plant numbers are not zero-padded.
    const fromServer = ["26J1", "26J10", "26J11", "26J12", "26J2", "26J3", "26J9"].map((s) => bundle(s));
    expect(labelRun(fromServer).map((i) => i.serial)).toEqual([
      "26J1",
      "26J2",
      "26J3",
      "26J9",
      "26J10",
      "26J11",
      "26J12",
    ]);
  });

  test("crossing 99 to 100 too, and every label carries its bundle id", () => {
    const run = labelRun([bundle("26J100"), bundle("26J99"), bundle("26J101")]);
    expect(run).toEqual([
      { bundleId: "id-26J99", serial: "26J99" },
      { bundleId: "id-26J100", serial: "26J100" },
      { bundleId: "id-26J101", serial: "26J101" },
    ]);
  });

  test("a void bundle gets no label", () => {
    const run = labelRun([bundle("26J2"), bundle("26J1", "void"), bundle("26J3", "dispatched")]);
    expect(run.map((i) => i.serial)).toEqual(["26J2", "26J3"]);
  });

  test("legacy serials keep their order", () => {
    const run = labelRun([bundle("BG-000012-B010"), bundle("BG-000012-B002"), bundle("BG-000012-B001")]);
    expect(run.map((i) => i.serial)).toEqual(["BG-000012-B001", "BG-000012-B002", "BG-000012-B010"]);
  });
});
