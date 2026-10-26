import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type ServerOptions, type UserConfig } from "vite";

// Relative TypeScript is bundled into the config by Vite (unlike workspace packages, see below).
import { manualChunk } from "./scripts/manual-chunks";

/**
 * The port resolver is TypeScript in @orrn/server, and Vite leaves workspace packages for Node to
 * load, which needs Node 22.18+. So it is imported here only for a bare `vite dev`: `vite build`
 * (check-types, CI, Alchemy deploys) and `vite dev --port` (Playwright) never load it and run on any
 * Node Vite supports (apps/web/src/vite-config.test.ts).
 */
async function loadDevPorts() {
  try {
    return await import("@orrn/server/lib/devPorts");
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== "ERR_UNKNOWN_FILE_EXTENSION") throw error;
    throw new Error(
      `A bare \`vite dev\` reads this worktree's ports from @orrn/server/lib/devPorts (TypeScript), which needs ` +
        `Node 22.18 or newer; this is Node ${process.version}. Upgrade Node, or pass --port <web port> (and set ` +
        `VITE_SERVER_URL / VITE_PUBLIC_URL yourself).`,
      { cause: error },
    );
  }
}

/**
 * Dev server only (`vite dev`; `vite preview` also runs with command "serve" but keeps Vite's own
 * preview defaults, see the config below). The port is this worktree's E2E_WEB_PORT (default 3002, the documented local port;
 * 3001 belongs to a foreign app) and is strict, so a taken port fails loudly instead of hopping to one
 * the API does not allow. An explicit `--port` on the command line (Playwright passes one for each
 * server it starts, with its own VITE_ values) wins, so the config only supplies the default.
 */
async function devServer(): Promise<ServerOptions> {
  const portOnCommandLine = process.argv.some((arg) => arg === "--port" || arg.startsWith("--port="));
  if (portOnCommandLine) return { strictPort: true };
  const { assertWorktreePorts, resolveDevPorts, viteEnvDefaults } = await loadDevPorts();
  assertWorktreePorts(process.env, import.meta.dirname, ["web"]);
  // Vite reads the env files after this and lets process.env win, so the app calls this worktree's
  // API even when apps/web/.env.development.local still names other ports.
  Object.assign(process.env, viteEnvDefaults(process.env));
  return { port: resolveDevPorts(process.env).webPort, strictPort: true };
}

/**
 * The web build keeps only the public `/` English in the entry chunk: `@orrn/i18n`'s `./dictionaries`
 * (every language, loaded up front for Bun tests and native) becomes `./dictionaries.web.ts`, which
 * fetches the full English and Hindi on demand. Keeps a first visit to `/` inside its JS budget
 * (scripts/check-route-budget.ts) as the dictionaries grow with every screen.
 */
const i18nDir = fileURLToPath(new URL("../../packages/i18n/src/", import.meta.url));
function lazyHindi(): Plugin {
  return {
    name: "orrn-lazy-hindi",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "./dictionaries" || !importer) return null;
      if (!importer.replaceAll("\\", "/").startsWith(i18nDir.replaceAll("\\", "/"))) return null;
      return `${i18nDir}dictionaries.web.ts`;
    },
  };
}

/**
 * Shown on Settings > About: the web app's version (this package.json, not an env var that only
 * exists under npm) and the day it was built.
 */
const packageVersion = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string }).version;
const buildInfo = {
  __ORRN_WEB_VERSION__: JSON.stringify(packageVersion ?? "dev"),
  __ORRN_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
};

export default defineConfig(async ({ command, isPreview }): Promise<UserConfig> => ({
  define: buildInfo,
  // `vite preview` is command "serve" too; it inherits server.strictPort, so it must not get the dev
  // server options (nor the worktree guard, nor the TypeScript resolver).
  server: command === "serve" && !isPreview ? await devServer() : undefined,
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Router/query vendor chunk only, matched by package name (scripts/manual-chunks.ts).
        manualChunks: manualChunk,
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    lazyHindi(),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
}));
