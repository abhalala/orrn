import { describe, expect, test } from "bun:test";

import { dispatchNow } from "./dispatch-now";

function fakeApi(fail: { reserve?: number; complete?: number } = {}) {
  const calls: string[] = [];
  const left = { reserve: fail.reserve ?? 0, complete: fail.complete ?? 0 };
  const step = (name: "reserve" | "complete") => async () => {
    calls.push(name);
    if (left[name] > 0) {
      left[name] -= 1;
      throw Object.assign(new Error(`${name} failed`), { data: { code: "CONFLICT" } });
    }
  };
  return { calls, api: { reserve: step("reserve"), complete: step("complete") } };
}

describe("dispatchNow", () => {
  test("from Building it holds the stock, then dispatches", async () => {
    const { calls, api } = fakeApi();
    const state = { held: false };
    await dispatchNow("draft", state, api);
    expect(calls).toEqual(["reserve", "complete"]);
    expect(state.held).toBe(true);
  });

  test("a held dispatch is only completed (the server refuses to hold it again)", async () => {
    const { calls, api } = fakeApi();
    await dispatchNow("reserved", { held: false }, api);
    expect(calls).toEqual(["complete"]);
  });

  test("a failed hold never completes and leaves nothing marked held", async () => {
    const { calls, api } = fakeApi({ reserve: 1 });
    const state = { held: false };
    await expect(dispatchNow("draft", state, api)).rejects.toThrow("reserve failed");
    expect(calls).toEqual(["reserve"]);
    expect(state.held).toBe(false);
  });

  test("a retry after a failed complete does not hold twice (the screen may still say Building)", async () => {
    const { calls, api } = fakeApi({ complete: 1 });
    const state = { held: false };
    await expect(dispatchNow("draft", state, api)).rejects.toThrow("complete failed");
    expect(state.held).toBe(true);
    // Second press of Dispatch in the same sheet, before the refreshed status arrives.
    await dispatchNow("draft", state, api);
    expect(calls).toEqual(["reserve", "complete", "complete"]);
  });

  test("a cancelled or dispatched dispatch is never sent anywhere", async () => {
    const { calls, api } = fakeApi();
    await expect(dispatchNow("completed", { held: false }, api)).rejects.toThrow();
    await expect(dispatchNow("cancelled", { held: false }, api)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
