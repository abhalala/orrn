/**
 * Fake Hermes for local runs and e2e (design 2026-11-18, §13). The frames and the steering messages are
 * in `packages/server/src/lib/buddy/fakeHermes.ts` (server tests use the same code in-process).
 *
 *   FAKE_HERMES_PORT=4790 bun apps/server/scripts/fake-hermes.ts
 *
 * Env: FAKE_HERMES_PORT (default 4790), FAKE_HERMES_KEY (default "fake-hermes-key"), FAKE_HERMES_MCP_URL
 * (default http://localhost:$E2E_API_PORT/mcp), FAKE_HERMES_MCP_TOKEN (or POST /__fake/token {"token"}).
 */
import { createFakeHermes } from "@orrn/server/lib/buddy/fakeHermes";

const port = Number(process.env.FAKE_HERMES_PORT ?? 4790);
const apiPort = process.env.E2E_API_PORT ?? "3000";
const mcpUrl = process.env.FAKE_HERMES_MCP_URL ?? `http://localhost:${apiPort}/mcp`;
const fake = createFakeHermes({
  apiKey: process.env.FAKE_HERMES_KEY ?? "fake-hermes-key",
  mcpUrl,
  mcpToken: process.env.FAKE_HERMES_MCP_TOKEN ?? null,
});
Bun.serve({ port, hostname: "127.0.0.1", fetch: (req) => fake.handle(req), idleTimeout: 255 });
console.log(`[fake-hermes] http://127.0.0.1:${port}  (POST /v1/responses; orrn MCP ${mcpUrl})`);
