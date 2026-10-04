import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ServerOptions, type UserConfig } from "vite";

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

export default defineConfig(async ({ command, isPreview }): Promise<UserConfig> => ({
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
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
}));
