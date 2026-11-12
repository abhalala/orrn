import { describe, expect, test } from "bun:test";

import { runOnce, type WriteGate } from "../features/foundry/reason-write";

describe("destructive confirm double taps", () => {
  for (const action of ["spectro void", "cast cancel", "melt cancel"] as const) {
    test(`${action}: two fast presses send one request`, async () => {
      const gate: WriteGate = { locked: false };
      let calls = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const send = () => {
        calls++;
        return pending;
      };

      const first = runOnce(gate, send);
      const second = runOnce(gate, send);
      expect(calls).toBe(1);
      release();
      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult.ran).toBe(true);
      expect(secondResult.ran).toBe(false);
      expect(gate.locked).toBe(false);
    });
  }

  test("a refusal releases the gate for a deliberate retry", async () => {
    const gate: WriteGate = { locked: false };
    await expect(runOnce(gate, async () => { throw new Error("refused"); })).rejects.toThrow("refused");
    expect(gate.locked).toBe(false);
    const retry = await runOnce(gate, async () => "sent");
    expect(retry).toEqual({ ran: true, value: "sent" });
  });
});
