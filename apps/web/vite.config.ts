import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3001,
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // No pdf/xlsx/react chunks: a name-based "react" rule also matched
          // @react-pdf and dragged the 1.4 MB renderer into every page's
          // modulepreload list. Export libs load via dynamic import only.
          // No "radix" or "form" group either: one group per library family
          // put every Radix primitive (dialog, select, menus) and TanStack
          // Form in the modulepreload list of every page, `/` included, for
          // the sake of a Slot. They now ride with the screens that use them
          // (`/` JS budget, scripts/check-route-budget.ts).
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@tanstack") && !id.includes("form")) return "tanstack";
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
});
