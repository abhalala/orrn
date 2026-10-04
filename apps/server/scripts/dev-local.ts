/**
 * `bun run dev:local`: the local API worker (wrangler dev, local D1) on THIS worktree's API port.
 *
 * Ports come from E2E_API_PORT / E2E_WEB_PORT (source `.wt-ports.env` in a worktree); with nothing
 * set it is today's API 3000 / web 3002. The worker's auth base URL and CORS/public web origin are
 * passed as `--var` overrides so they match the ports. See packages/server/src/lib/devPorts.ts.
 *
 * Local D1 state stays per worktree: wrangler keeps it in apps/server/.wrangler/state, next to
 * this file's package, and every worktree has its own copy of the repo.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertWorktreePorts, devLocalWranglerArgs, resolveDevPorts } from "@orrn/server/lib/devPorts";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  assertWorktreePorts(process.env, serverDir, ["api", "web"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const ports = resolveDevPorts(process.env);
const args = devLocalWranglerArgs(ports);
console.log(`[dev:local] API ${ports.apiURL}  (web origin ${ports.webURL})`);

const child = spawn("wrangler", args, { cwd: serverDir, stdio: "inherit" });

// Playwright and shells stop us with a signal; take wrangler (and its workerd child) down with us.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on("error", (error) => {
  console.error(`[dev:local] could not start wrangler: ${error.message}`);
  process.exit(1);
});
