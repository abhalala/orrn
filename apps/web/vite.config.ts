import tailwindcss from "@tailwindcss/vite";
import { tamaguiPlugin } from "@tamagui/vite-plugin";
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
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@react-pdf")) return "pdf-export";
          if (id.includes("xlsx")) return "xlsx";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("tamagui") || id.includes("@tamagui")) {
            return "tamagui";
          }
          if (id.includes("react") || id.includes("react-dom")) {
            return "react-vendor";
          }
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
    tamaguiPlugin({
      config: "../../packages/ui/src/tamagui.config.ts",
      components: ["tamagui", "@orrn/ui"],
      outputCSS: "./src/tamagui.generated.css",
    }),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
