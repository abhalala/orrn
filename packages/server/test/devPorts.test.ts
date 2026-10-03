import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertWorktreePorts,
  devLocalWranglerArgs,
  resolveDevPorts,
} from "../src/lib/devPorts";

describe("resolveDevPorts defaults (today's stack)", () => {
  test("no env -> API 3000, web 3002, visual 3001", () => {
    const p = resolveDevPorts({});
    expect(p.apiPort).toBe(3000);
    expect(p.webPort).toBe(3002);
    expect(p.visualPort).toBe(3001);
    expect(p.apiURL).toBe("http://localhost:3000");
    expect(p.webURL).toBe("http://localhost:3002");
    expect(p.visualURL).toBe("http://127.0.0.1:3001");
  });
});

describe("resolveDevPorts per-worktree ports", () => {
  test("E2E_API_PORT / E2E_WEB_PORT drive ports and URLs", () => {
    const p = resolveDevPorts({ E2E_API_PORT: "3290", E2E_WEB_PORT: "3291" });
    expect(p.apiPort).toBe(3290);
    expect(p.webPort).toBe(3291);
    expect(p.apiURL).toBe("http://localhost:3290");
    expect(p.webURL).toBe("http://localhost:3291");
  });

  test("the URL vars alone also work (ports are read from them)", () => {
    const p = resolveDevPorts({ E2E_API_URL: "http://localhost:3292", E2E_BASE_URL: "http://localhost:3293" });
    expect(p.apiPort).toBe(3292);
    expect(p.webPort).toBe(3293);
    expect(p.apiURL).toBe("http://localhost:3292");
    expect(p.webURL).toBe("http://localhost:3293");
  });

  test("port and URL that agree are fine", () => {
    const p = resolveDevPorts({
      E2E_API_PORT: "3200",
      E2E_API_URL: "http://localhost:3200",
      E2E_WEB_PORT: "3201",
      E2E_BASE_URL: "http://localhost:3201",
    });
    expect([p.apiPort, p.webPort]).toEqual([3200, 3201]);
  });

  test("port and URL that disagree are refused, naming both", () => {
    expect(() => resolveDevPorts({ E2E_API_PORT: "3200", E2E_API_URL: "http://localhost:3201" })).toThrow(
      /E2E_API_PORT.*3200.*E2E_API_URL.*3201/s,
    );
    expect(() => resolveDevPorts({ E2E_WEB_PORT: "3200", E2E_BASE_URL: "http://localhost:3201" })).toThrow(
      /E2E_WEB_PORT.*E2E_BASE_URL/s,
    );
  });

  test("non-numeric or out-of-range ports are refused", () => {
    expect(() => resolveDevPorts({ E2E_API_PORT: "abc" })).toThrow(/E2E_API_PORT/);
    expect(() => resolveDevPorts({ E2E_WEB_PORT: "0" })).toThrow(/E2E_WEB_PORT/);
    expect(() => resolveDevPorts({ E2E_WEB_PORT: "70000" })).toThrow(/E2E_WEB_PORT/);
    expect(() => resolveDevPorts({ E2E_API_PORT: "32.5" })).toThrow(/E2E_API_PORT/);
  });

  test("blank values count as unset (an empty exported var must not break the defaults)", () => {
    const p = resolveDevPorts({ E2E_API_PORT: "", E2E_WEB_PORT: "  " });
    expect([p.apiPort, p.webPort]).toEqual([3000, 3002]);
  });

  test("API and web on the same port are refused", () => {
    expect(() => resolveDevPorts({ E2E_API_PORT: "3300", E2E_WEB_PORT: "3300" })).toThrow(/same port/);
  });

  test("a URL without an explicit port uses the scheme default", () => {
    expect(resolveDevPorts({ E2E_BASE_URL: "https://dev.example.test" }).webPort).toBe(443);
    expect(resolveDevPorts({ E2E_BASE_URL: "http://dev.example.test" }).webPort).toBe(80);
  });
});

describe("visual (public pages) port", () => {
  test("defaults to 3001 only when no per-worktree web port is set", () => {
    expect(resolveDevPorts({}).visualPort).toBe(3001);
  });

  test("in a worktree it is the web port + 100, so it never lands on 3001", () => {
    const p = resolveDevPorts({ E2E_API_PORT: "3200", E2E_WEB_PORT: "3201" });
    expect(p.visualPort).toBe(3301);
    expect(p.visualURL).toBe("http://127.0.0.1:3301");
  });

  test("VISUAL_WEB_PORT wins over the derived one", () => {
    const p = resolveDevPorts({ E2E_WEB_PORT: "3201", VISUAL_WEB_PORT: "3555" });
    expect(p.visualPort).toBe(3555);
  });

  test("PLAYWRIGHT_BASE_URL wins over everything and gives the port", () => {
    const p = resolveDevPorts({
      E2E_WEB_PORT: "3201",
      VISUAL_WEB_PORT: "3555",
      PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3777",
    });
    expect(p.visualPort).toBe(3777);
    expect(p.visualURL).toBe("http://127.0.0.1:3777");
  });

  test("a visual port equal to the API or web port is refused", () => {
    expect(() => resolveDevPorts({ E2E_WEB_PORT: "3201", VISUAL_WEB_PORT: "3201" })).toThrow(/same port/);
    expect(() => resolveDevPorts({ E2E_API_PORT: "3201", VISUAL_WEB_PORT: "3201" })).toThrow(/same port/);
  });
});

describe("devLocalWranglerArgs", () => {
  test("binds the worker to the API port and points auth + CORS at this worktree's own ports", () => {
    const args = devLocalWranglerArgs(resolveDevPorts({ E2E_API_PORT: "3290", E2E_WEB_PORT: "3291" }));
    expect(args.slice(0, 4)).toEqual(["dev", "-c", "wrangler.local.jsonc", "--port"]);
    expect(args[4]).toBe("3290");
    const vars = new Map<string, string>();
    args.forEach((a, i) => {
      if (a === "--var") {
        const [k, ...rest] = (args[i + 1] ?? "").split(":");
        vars.set(k!, rest.join(":"));
      }
    });
    expect(vars.get("BETTER_AUTH_URL")).toBe("http://localhost:3290");
    expect(vars.get("CORS_ORIGIN")).toBe("http://localhost:3291");
    expect(vars.get("CORS_ALLOWED_ORIGINS")).toBe("http://localhost:3291");
    expect(vars.get("WEB_PUBLIC_URL")).toBe("http://localhost:3291");
  });

  test("never binds the shared default inspector port 9229 (two concurrent workers would race for it)", () => {
    const args = devLocalWranglerArgs(resolveDevPorts({ E2E_API_PORT: "3290", E2E_WEB_PORT: "3291" }));
    const at = args.indexOf("--inspector-port");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe("0"); // 0 = let the OS pick a free one
    expect(args).not.toContain("9229");
  });

  test("defaults reproduce today's wrangler.local.jsonc values", () => {
    const args = devLocalWranglerArgs(resolveDevPorts({}));
    expect(args).toContain("3000");
    expect(args).toContain("CORS_ORIGIN:http://localhost:3002");
    expect(args).toContain("BETTER_AUTH_URL:http://localhost:3000");
  });

  test("uses the origin of the URL vars, dropping any path", () => {
    const args = devLocalWranglerArgs(
      resolveDevPorts({ E2E_API_URL: "http://127.0.0.1:3292/", E2E_BASE_URL: "http://127.0.0.1:3293/app" }),
    );
    expect(args).toContain("BETTER_AUTH_URL:http://127.0.0.1:3292");
    expect(args).toContain("WEB_PUBLIC_URL:http://127.0.0.1:3293");
  });
});

describe("assertWorktreePorts (never fall back to the shared defaults from a worktree)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "orrn-wt-"));
    mkdirSync(join(root, "apps", "web"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const nested = () => join(root, "apps", "web");

  test("a plain checkout (no .wt-ports.env anywhere above) is never blocked", () => {
    expect(() => assertWorktreePorts({}, nested(), ["api", "web"])).not.toThrow();
  });

  test("a worktree without the vars is refused, with the fix in the message", () => {
    writeFileSync(join(root, ".wt-ports.env"), "export E2E_API_PORT=3200\n");
    expect(() => assertWorktreePorts({}, nested(), ["api"])).toThrow(/E2E_API_PORT.*source \.wt-ports\.env/s);
    expect(() => assertWorktreePorts({}, nested(), ["web"])).toThrow(/E2E_WEB_PORT/);
  });

  test("a worktree with the vars (or their URL twins) passes", () => {
    writeFileSync(join(root, ".wt-ports.env"), "");
    expect(() =>
      assertWorktreePorts({ E2E_API_PORT: "3200", E2E_WEB_PORT: "3201" }, nested(), ["api", "web"]),
    ).not.toThrow();
    expect(() =>
      assertWorktreePorts({ E2E_API_URL: "http://localhost:3200", E2E_BASE_URL: "http://localhost:3201" }, nested(), [
        "api",
        "web",
      ]),
    ).not.toThrow();
  });

  test("visual needs any of VISUAL_WEB_PORT, PLAYWRIGHT_BASE_URL or the web port", () => {
    writeFileSync(join(root, ".wt-ports.env"), "");
    expect(() => assertWorktreePorts({}, nested(), ["visual"])).toThrow(/VISUAL_WEB_PORT/);
    expect(() => assertWorktreePorts({ VISUAL_WEB_PORT: "3301" }, nested(), ["visual"])).not.toThrow();
    expect(() => assertWorktreePorts({ E2E_WEB_PORT: "3201" }, nested(), ["visual"])).not.toThrow();
    expect(() =>
      assertWorktreePorts({ PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3301" }, nested(), ["visual"]),
    ).not.toThrow();
  });
});
