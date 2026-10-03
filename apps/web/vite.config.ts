import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { assertWorktreePorts, resolveDevPorts } from "@orrn/server/lib/devPorts";
import { defineConfig } from "vite";

/**
 * Dev server only (not `vite build`, which check-types runs). The port is this worktree's
 * E2E_WEB_PORT (default 3002, the documented local port; 3001 belongs to a foreign app) and is
 * strict, so a taken port fails loudly instead of hopping to one the API does not allow.
 * An explicit `--port` on the command line (Playwright passes one for each server it starts) wins,
 * so the config only supplies the default.
 */
function devServer() {
  const portOnCommandLine = process.argv.some((arg) => arg === "--port" || arg.startsWith("--port="));
  if (portOnCommandLine) return { strictPort: true };
  assertWorktreePorts(process.env, import.meta.dirname, ["web"]);
  return { port: resolveDevPorts(process.env).webPort, strictPort: true };
}

export default defineConfig(({ command }) => ({
  server: command === "serve" ? devServer() : undefined,
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // No pdf/xlsx/react chunks: a name-based "react" rule also matched
          // @react-pdf and dragged the 1.4 MB renderer into every page's
          // modulepreload list. Export libs load via dynamic import only.
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("papaparse")) return "csv-parser";
          return undefined;
        },
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
