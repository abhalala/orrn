/**
 * Fix brief item 20 (delta review SF3): signed tickets must not land in Workers Logs. Alchemy 0.91.2 turns
 * observability on by default, and invocation records keep the full request URL with its query string. The server
 * Worker now sends `logs.invocation_logs: false` and keeps console lines.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SERVER_OBSERVABILITY } from "../src/infra/observability";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = readFileSync(join(HERE, "../src/infra/alchemy.run.ts"), "utf8");

/** What Alchemy 0.91.2 uploads (worker-metadata.ts): keys camel to snake, then `enabled: observability?.enabled !== false`. */
function snake(o: unknown): unknown {
  if (!o || typeof o !== "object") return o;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), snake(v)]));
}
function asUploaded(observability: unknown): Record<string, unknown> {
  const s = snake(observability) as Record<string, unknown> | undefined;
  return { ...s, enabled: s?.enabled !== false };
}

describe("server Worker observability (alchemy.run.ts)", () => {
  test("invocation records are off and console logs stay on, as Cloudflare receives it", async () => {
    const sent = asUploaded(SERVER_OBSERVABILITY);
    expect(sent).toEqual({ enabled: true, logs: { enabled: true, invocation_logs: false } });
  });

  test("the server Worker passes it; leaving the key out would turn invocation records on", () => {
    const block = RUN.slice(RUN.indexOf('export const server = await Worker("server"'));
    const props = block.slice(0, block.indexOf("bindings:"));
    expect(props).toContain("observability: SERVER_OBSERVABILITY");
    expect(asUploaded(undefined)).toEqual({ enabled: true });
  });
});
