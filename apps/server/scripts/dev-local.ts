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
// orrn buddy against the fake Hermes (scripts/fake-hermes.ts): BUDDY_FAKE_HERMES_PORT=<port> turns the
// buddy on for this local worker, for the demo plant unless BUDDY_COMPANIES names others. Fake values only.
const fakeHermesPort = process.env.BUDDY_FAKE_HERMES_PORT?.trim();
if (fakeHermesPort && /^\d+$/.test(fakeHermesPort)) {
  args.push(
    "--var", `HERMES_BASE_URL:http://127.0.0.1:${fakeHermesPort}`,
    "--var", "HERMES_ACCESS_CLIENT_ID:fake-access-id",
    "--var", "HERMES_ACCESS_CLIENT_SECRET:fake-access-secret",
    "--var", `HERMES_API_KEY:${process.env.FAKE_HERMES_KEY ?? "fake-hermes-key"}`,
    "--var", `BUDDY_COMPANIES:${process.env.BUDDY_COMPANIES ?? "orrn-demo"}`,
  );
  console.log(`[dev:local] buddy on, fake Hermes at http://127.0.0.1:${fakeHermesPort}`);
}
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
