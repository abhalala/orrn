import { fakeResponse, FakeShapeClient, setShapeClientForTests } from "@orrn/server/lib/ingest/bot/index";
import { z } from "zod";

/**
 * Local-only switch for the Infinity Portal e2e: installs a scripted shape client in place of the real model, so a
 * browser test can walk a sheet with unknown headers through "Map columns for me" without an API key or a network
 * call. Same gate as POST /dev/seed (development, the local password binding, a loopback host); the route does not
 * exist anywhere else. `responses` are the model's JSON answers, in order (`{ result: { kind: "recipe", recipe } }`
 * or `{ result: { kind: "no_target", reason } }`). `clear` removes the client again.
 */
export const devIngestBotInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("install"), responses: z.array(z.unknown()).min(1).max(8) }),
  z.object({ action: z.literal("clear") }),
]);

export function runDevIngestBot(input: z.infer<typeof devIngestBotInput>) {
  if (input.action === "clear") {
    setShapeClientForTests(null);
    return { ok: true as const, installed: false as const };
  }
  setShapeClientForTests(new FakeShapeClient(input.responses.map((json) => fakeResponse(json))));
  return { ok: true as const, installed: true as const, responses: input.responses.length };
}
