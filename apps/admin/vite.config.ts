import tailwindcss from "@tailwindcss/vite";
import { tamaguiPlugin } from "@tamagui/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3003,
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tamaguiPlugin({
      config: "../../packages/design/src/tamagui.config.ts",
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
