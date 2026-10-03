/**
 * apps/web/vite.config.ts is loaded by Node (Vite runs under the `node` shebang, also in CI and in
 * Alchemy deploys). Vite bundles the config but leaves workspace packages external, so Node itself
 * would have to load any `@orrn/*` TypeScript the config imports, which only Node 22.18+ can.
 *
 * - `vite build` (check-types, deploy) and `vite dev --port` (Playwright) must load on any Node Vite
 *   supports: checked by loading the config with TypeScript stripping switched off.
 * - A bare `vite dev` reads this worktree's ports from @orrn/server/lib/devPorts and points the app
 *   at them (VITE_SERVER_URL / VITE_PUBLIC_URL), beating apps/web/.env.development.local.
 *
 * Each Node process loads the config several times (one scenario per load) because the plugins
 * take seconds to import; one process per Node mode keeps the file at two launches.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = Bun.which("node");

function nodeVersion(): [number, number] {
  if (!nodeBin) return [0, 0];
  const out = Bun.spawnSync({ cmd: [nodeBin, "--version"] }).stdout.toString().trim();
  const [major = 0, minor = 0] = out.replace(/^v/, "").split(".").map(Number);
  return [major, minor];
}

const [major, minor] = nodeVersion();
const atLeast = (m: number, n: number) => major > m || (major === m && minor >= n);
/** `--no-experimental-strip-types` exists from Node 22.6; older Node cannot strip types at all. */
const noStripFlags = atLeast(22, 6) ? ["--no-experimental-strip-types"] : [];
/** Native TypeScript loading without a flag: Node 22.18+ and 23.6+. */
const nodeStripsTypes = atLeast(23, 6) || (major === 22 && minor >= 18);

interface Scenario {
  name: string;
  command: "build" | "serve";
  argv?: string[];
  env?: Record<string, string>;
}

interface Outcome {
  server?: Record<string, unknown> | null;
  VITE_SERVER_URL?: string | null;
  VITE_PUBLIC_URL?: string | null;
  error?: string;
}

/**
 * Loads the config the way `vite <command>` does (default bundle loader), then the env files the
 * way Vite does after the config. argv and env are set per scenario and restored afterwards.
 */
const LOADER = `
import { loadConfigFromFile, loadEnv } from "vite";
const scenarios = JSON.parse(process.env.ORRN_TEST_SCENARIOS);
const baseArgv = [...process.argv];
const out = {};
for (const s of scenarios) {
  const savedEnv = { ...process.env };
  process.argv = [...baseArgv, ...(s.argv ?? [])];
  Object.assign(process.env, s.env ?? {});
  const mode = s.command === "build" ? "production" : "development";
  try {
    const loaded = await loadConfigFromFile({ command: s.command, mode }, "vite.config.ts", process.cwd(), "silent");
    const env = loadEnv(mode, process.cwd(), "VITE_");
    out[s.name] = {
      server: loaded?.config.server ?? null,
      VITE_SERVER_URL: env.VITE_SERVER_URL ?? null,
      VITE_PUBLIC_URL: env.VITE_PUBLIC_URL ?? null,
    };
  } catch (error) {
    out[s.name] = { error: String(error?.stack ?? error) + " code=" + String(error?.code ?? error?.cause?.code) };
  }
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  process.argv = baseArgv;
}
console.log("ORRN_RESULT " + JSON.stringify(out));
`;

/** A clean environment: no ports or VITE_ values leak in from the shell running the tests. */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(E2E_|VITE_|VISUAL_WEB_PORT$|PLAYWRIGHT_|NODE_OPTIONS$)/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

function runScenarios(nodeFlags: string[], scenarios: Scenario[]): Record<string, Outcome> {
  const proc = Bun.spawnSync({
    cmd: [nodeBin!, ...nodeFlags, "--input-type=module", "-e", LOADER],
    cwd: webDir,
    env: { ...baseEnv(), ORRN_TEST_SCENARIOS: JSON.stringify(scenarios) },
  });
  const line = proc.stdout
    .toString()
    .split("\n")
    .find((l) => l.startsWith("ORRN_RESULT "));
  if (!line) throw new Error(`config loader crashed (exit ${proc.exitCode}):\n${proc.stderr.toString()}`);
  return JSON.parse(line.slice("ORRN_RESULT ".length));
}

const ports = { E2E_API_PORT: "3298", E2E_WEB_PORT: "3299" };

describe.skipIf(!nodeBin)("vite.config.ts on a Node that cannot load TypeScript", () => {
  let results: Record<string, Outcome> = {};
  beforeAll(() => {
    results = runScenarios(noStripFlags, [
      { name: "build", command: "build", env: ports },
      { name: "devWithPort", command: "serve", argv: ["--port", "4321"], env: ports },
      { name: "bareDev", command: "serve", env: ports },
    ]);
  }, 60_000);

  test("vite build loads the config (CI and deploy runners)", () => {
    expect(results.build?.error).toBeUndefined();
    expect(results.build?.server ?? null).toBeNull();
  });

  test("vite dev --port (how Playwright starts it) loads the config", () => {
    expect(results.devWithPort?.error).toBeUndefined();
    expect(results.devWithPort?.server).toEqual({ strictPort: true });
  });

  test("a bare vite dev says which Node it needs instead of a bare ERR_UNKNOWN_FILE_EXTENSION", () => {
    expect(results.bareDev?.error).toContain("Node 22.18");
    expect(results.bareDev?.error).toContain("--port");
  });
});

describe.skipIf(!nodeBin || !nodeStripsTypes)("vite.config.ts bare vite dev (worktree ports)", () => {
  let results: Record<string, Outcome> = {};
  beforeAll(() => {
    results = runScenarios([], [
      { name: "ports", command: "serve", env: ports },
      {
        name: "explicitVite",
        command: "serve",
        env: { ...ports, VITE_SERVER_URL: "https://api.dev.example", VITE_PUBLIC_URL: "https://web.dev.example" },
      },
    ]);
  }, 60_000);

  test("serves on the worktree web port and points the app at the worktree API", () => {
    expect(results.ports?.error).toBeUndefined();
    expect(results.ports?.server).toEqual({ port: 3299, strictPort: true });
    // Beats apps/web/.env.development.local, which may still name other ports.
    expect(results.ports?.VITE_SERVER_URL).toBe("http://localhost:3298");
    expect(results.ports?.VITE_PUBLIC_URL).toBe("http://localhost:3299");
  });

  test("VITE_ values already in the environment win over the derived ones", () => {
    expect(results.explicitVite?.error).toBeUndefined();
    expect(results.explicitVite?.VITE_SERVER_URL).toBe("https://api.dev.example");
    expect(results.explicitVite?.VITE_PUBLIC_URL).toBe("https://web.dev.example");
  });
});
