import { describe, expect, test } from "bun:test";

import { newRequestKey, noReply, sendOnce } from "./request-key";

describe("floor write keys (BACKLOG 50)", () => {
  test("a key fits the server's clientRequestId rule", () => {
    expect(newRequestKey()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(newRequestKey()).not.toBe(newRequestKey());
  });

  test("no reply: sent once more with the same key", async () => {
    const keys: string[] = [];
    const out = await sendOnce(async (k) => {
      keys.push(k);
      if (keys.length === 1) throw new TypeError("Failed to fetch");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]!);
  });

  test("a refusal from orrn is not sent again", async () => {
    let calls = 0;
    const refusal = Object.assign(new Error("Dispatch not found"), { data: { code: "NOT_FOUND", httpStatus: 404 } });
    await expect(
      sendOnce(async () => {
        calls += 1;
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(calls).toBe(1);
    expect(noReply(refusal)).toBe(false);
    expect(noReply(Object.assign(new Error("gateway"), { data: { httpStatus: 504 } }))).toBe(true);
  });
});
