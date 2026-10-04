/**
 * Local dev + e2e ports, one source of truth for every entrypoint:
 *
 * - apps/server/scripts/dev-local.ts  (wrangler dev on the API port)
 * - apps/web/vite.config.ts           (bare Vite dev server: web port, VITE_SERVER_URL/VITE_PUBLIC_URL;
 *                                      imported lazily there so `vite build` never loads this file)
 * - apps/web/playwright.config.ts     (webServer commands, reuse checks, base URLs)
 * - apps/web/tests/e2e/helpers/ports.ts (test-side URLs)
 *
 * Each git worktree gets its own pair in `.wt-ports.env` at its root (source it before dev/e2e; the
 * recipe is in docs/LOCAL_DEV.md "Worktrees"). The variables keep their historical E2E_ prefix, but
 * they drive the plain dev servers too, so the environment is the one place that says "my ports":
 * values derived from them (wrangler --var, VITE_SERVER_URL/VITE_PUBLIC_URL) beat the env files.
 *
 *   E2E_API_PORT  / E2E_API_URL   API worker      default 3000
 *   E2E_WEB_PORT  / E2E_BASE_URL  Vite web app    default 3002
 *   VISUAL_WEB_PORT / PLAYWRIGHT_BASE_URL  public-page visual suite, default 3001
 *
 * Defaults are the original single-checkout ports. 3001 is a foreign app on this Mac, so a
 * worktree never gets it: whenever a web port is set (E2E_WEB_PORT or E2E_BASE_URL) and the visual
 * port is not, the visual port is web + 100.
 *
 * Pure and dependency-free apart from node:fs/path (tooling only, never imported by the Worker).
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_API_PORT = 3000;
export const DEFAULT_WEB_PORT = 3002;
export const DEFAULT_VISUAL_PORT = 3001;
/** Visual port = web port + this when a per-worktree web port is set. */
export const VISUAL_PORT_OFFSET = 100;
/** Sits at the root of every worktree that has its own ports (docs/LOCAL_DEV.md "Worktrees"). */
export const WORKTREE_PORTS_FILE = ".wt-ports.env";
/** Exported by `.wt-ports.env`: the worktree whose ports the environment holds. */
export const WORKTREE_ROOT_VAR = "ORRN_WT_ROOT";

export type DevPortsEnv = Readonly<Record<string, string | undefined>>;

export interface DevPorts {
  apiPort: number;
  webPort: number;
  /** Port of the bare Vite server the visual (public pages) suite runs against. */
  visualPort: number;
  apiURL: string;
  webURL: string;
  visualURL: string;
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePort(name: string, raw: string): number {
  const port = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number from 1 to 65535, got "${raw}".`);
  }
  return port;
}

function portOfUrl(name: string, raw: string): number {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a URL such as http://localhost:3201, got "${raw}".`);
  }
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

/** One service: the port var and the URL var must agree when both are set. */
function resolveService(
  env: DevPortsEnv,
  portVar: string,
  urlVar: string,
  fallbackPort: number,
): { port: number; url: string | undefined; explicit: boolean } {
  const rawPort = blankToUndefined(env[portVar]);
  const rawUrl = blankToUndefined(env[urlVar]);
  const fromPort = rawPort === undefined ? undefined : parsePort(portVar, rawPort);
  const fromUrl = rawUrl === undefined ? undefined : portOfUrl(urlVar, rawUrl);
  if (fromPort !== undefined && fromUrl !== undefined && fromPort !== fromUrl) {
    throw new Error(
      `${portVar}=${fromPort} disagrees with ${urlVar}=${rawUrl} (port ${fromUrl}). Set one of them, or make them match.`,
    );
  }
  return {
    port: fromPort ?? fromUrl ?? fallbackPort,
    url: rawUrl,
    explicit: fromPort !== undefined || fromUrl !== undefined,
  };
}

export function resolveDevPorts(env: DevPortsEnv): DevPorts {
  const api = resolveService(env, "E2E_API_PORT", "E2E_API_URL", DEFAULT_API_PORT);
  const web = resolveService(env, "E2E_WEB_PORT", "E2E_BASE_URL", DEFAULT_WEB_PORT);

  // Visual suite: PLAYWRIGHT_BASE_URL (existing override) > VISUAL_WEB_PORT > web port + 100 when a
  // worktree web port is set > the original 3001.
  const rawVisualUrl = blankToUndefined(env.PLAYWRIGHT_BASE_URL);
  const rawVisualPort = blankToUndefined(env.VISUAL_WEB_PORT);
  const visualPort =
    rawVisualUrl !== undefined
      ? portOfUrl("PLAYWRIGHT_BASE_URL", rawVisualUrl)
      : rawVisualPort !== undefined
        ? parsePort("VISUAL_WEB_PORT", rawVisualPort)
        : web.explicit
          ? web.port + VISUAL_PORT_OFFSET
          : DEFAULT_VISUAL_PORT;
  const visual = { port: visualPort, url: rawVisualUrl };

  if (api.port === web.port) {
    throw new Error(`API and web would share the same port ${api.port}. Give them different ports.`);
  }
  if (visual.port === api.port || visual.port === web.port) {
    throw new Error(`The visual-suite web server would share the same port ${visual.port} as the API or the web app.`);
  }

  return {
    apiPort: api.port,
    webPort: web.port,
    visualPort: visual.port,
    apiURL: api.url ?? `http://localhost:${api.port}`,
    webURL: web.url ?? `http://localhost:${web.port}`,
    visualURL: visual.url ?? `http://127.0.0.1:${visual.port}`,
  };
}

/** True when the environment names this service's port (port or URL variable, not blank). */
function hasExplicitPort(env: DevPortsEnv, portVar: string, urlVar: string): boolean {
  return blankToUndefined(env[portVar]) !== undefined || blankToUndefined(env[urlVar]) !== undefined;
}

export interface ViteEnvDefaults {
  VITE_SERVER_URL?: string;
  VITE_PUBLIC_URL?: string;
}

/**
 * VITE_SERVER_URL / VITE_PUBLIC_URL for a bare `vite dev` (apps/web/vite.config.ts) whose ports came
 * from the environment, so the app calls the API on the ports the shell says even when
 * apps/web/.env.development.local names other ones (Vite lets process.env beat env files).
 * A value already in the environment wins (Playwright and Alchemy pass their own); a service with no
 * port variable gets nothing, so a plain checkout keeps reading its env file.
 */
export function viteEnvDefaults(env: DevPortsEnv): ViteEnvDefaults {
  const ports = resolveDevPorts(env);
  const out: ViteEnvDefaults = {};
  if (hasExplicitPort(env, "E2E_API_PORT", "E2E_API_URL") && blankToUndefined(env.VITE_SERVER_URL) === undefined) {
    out.VITE_SERVER_URL = new URL(ports.apiURL).origin;
  }
  if (hasExplicitPort(env, "E2E_WEB_PORT", "E2E_BASE_URL") && blankToUndefined(env.VITE_PUBLIC_URL) === undefined) {
    out.VITE_PUBLIC_URL = new URL(ports.webURL).origin;
  }
  return out;
}

/**
 * `wrangler dev` arguments for apps/server/wrangler.local.jsonc on this worktree's ports.
 * `--port` beats `dev.port` in the config, and `--var` beats `vars`, so the committed config keeps
 * today's defaults (API 3000, web 3002) and only the process knows about the worktree.
 */
export function devLocalWranglerArgs(ports: Pick<DevPorts, "apiURL" | "webURL" | "apiPort">): string[] {
  const apiOrigin = new URL(ports.apiURL).origin;
  const webOrigin = new URL(ports.webURL).origin;
  return [
    "dev",
    "-c",
    "wrangler.local.jsonc",
    "--port",
    String(ports.apiPort),
    // The inspector defaults to 9229 for every worker; two worktrees starting together race for it and
    // the loser dies with "Address already in use". 0 lets the OS pick a free port per worker.
    "--inspector-port",
    "0",
    "--var",
    `BETTER_AUTH_URL:${apiOrigin}`,
    "--var",
    `CORS_ORIGIN:${webOrigin}`,
    "--var",
    `CORS_ALLOWED_ORIGINS:${webOrigin}`,
    "--var",
    `WEB_PUBLIC_URL:${webOrigin}`,
  ];
}

export type PortNeed = "api" | "web" | "visual";

const NEED_VARS: Record<PortNeed, readonly string[]> = {
  api: ["E2E_API_PORT", "E2E_API_URL"],
  web: ["E2E_WEB_PORT", "E2E_BASE_URL"],
  visual: ["VISUAL_WEB_PORT", "PLAYWRIGHT_BASE_URL", "E2E_WEB_PORT", "E2E_BASE_URL"],
};

/** Same directory, ignoring trailing slashes and symlinks (macOS /var vs /private/var). */
function samePath(a: string, b: string): boolean {
  const canonical = (path: string) => {
    const resolved = resolve(path);
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  };
  return canonical(a) === canonical(b);
}

function findWorktreeRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, WORKTREE_PORTS_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Refuse to start a dev/e2e entrypoint from a ports worktree (a `.wt-ports.env` exists above
 * `startDir`) when that worktree's ports are not in the environment. Without this the entrypoints
 * fall back to the shared defaults (API 3000, web 3002, visual 3001), reuse whichever server is
 * already there (possibly another worktree's, or a foreign app) and test the wrong code.
 *
 * `.wt-ports.env` also exports ORRN_WT_ROOT, so the environment says whose ports it holds: a shell
 * that sourced another worktree's file (or inherited it) is refused too, because the entrypoints
 * would reuse that worktree's servers. Without the variable (an older `.wt-ports.env`, or ports set
 * by hand) only the presence of the ports is checked.
 * A plain checkout has no marker file and is blocked only when ORRN_WT_ROOT names a worktree.
 */
export function assertWorktreePorts(env: DevPortsEnv, startDir: string, needs: readonly PortNeed[]): void {
  const root = findWorktreeRoot(startDir);
  const portsOf = blankToUndefined(env[WORKTREE_ROOT_VAR]);
  if (portsOf !== undefined && (root === undefined || !samePath(portsOf, root))) {
    const here = root ?? resolve(startDir);
    throw new Error(
      `${WORKTREE_ROOT_VAR}=${portsOf}: the ports in this environment belong to that worktree, but this is ${here}, ` +
        `so this would reuse that worktree's servers and test its code. Open a new shell (or unset ${WORKTREE_ROOT_VAR} ` +
        `and the E2E_ variables)` +
        (root ? `, run: source .wt-ports.env (in ${root})` : "") +
        `, and retry.`,
    );
  }
  if (!root) return;
  for (const need of needs) {
    const vars = NEED_VARS[need];
    if (vars.some((name) => blankToUndefined(env[name]))) continue;
    throw new Error(
      `${root} is an orrn worktree but ${vars[0]} is not set, so this would fall back to the shared default port ` +
        `and could attach to another worktree's server. Run: source .wt-ports.env (in ${root}) and retry.`,
    );
  }
}
