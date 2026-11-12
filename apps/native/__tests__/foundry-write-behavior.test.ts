import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { foundryError } from "../features/foundry/errors";
import { castCancelBody, meltCancelBody, runOnce, spectroVoidBody, type WriteGate } from "../features/foundry/reason-write";

describe("destructive write behavior", () => {
  test("void sends its id and trimmed reason", async () => {
    const gate: WriteGate = { locked: false };
    const seen: unknown[] = [];
    await runOnce(gate, async () => { seen.push(spectroVoidBody("result-1", "  wrong element  ")); });
    expect(seen).toEqual([{ id: "result-1", reason: "wrong element" }]);
  });

  test("cast cancel sends its cast id and trimmed reason", async () => {
    const gate: WriteGate = { locked: false };
    const seen: unknown[] = [];
    await runOnce(gate, async () => { seen.push(castCancelBody("cast-1", "  opened by mistake  ")); });
    expect(seen).toEqual([{ castId: "cast-1", reason: "opened by mistake" }]);
  });

  test("melt cancel sends its melt id and trimmed reason", async () => {
    const gate: WriteGate = { locked: false };
    const seen: unknown[] = [];
    await runOnce(gate, async () => { seen.push(meltCancelBody("melt-1", "  locked by mistake  ")); });
    expect(seen).toEqual([{ meltId: "melt-1", reason: "locked by mistake" }]);
  });

  test("server refusals become the sentences shown by the sheets", async () => {
    const { t } = createI18n("en");
    const cases = [
      { server: "This result is already void", shown: "This result is already void." },
      { server: "K31 has melts; cancel or discard them first", shown: "Cast K31 has melts. Cancel or discard them first." },
      { server: "This melt is already cancelled", shown: "This melt is cancelled." },
    ];
    for (const { server, shown } of cases) {
      const error = { message: server, data: { code: "BAD_REQUEST", httpStatus: 400 } };
      const gate: WriteGate = { locked: false };
      await expect(runOnce(gate, async () => { throw error; })).rejects.toBe(error);
      expect({ server, shown: foundryError(t, error) }).toEqual({ server, shown });
    }
  });
});
