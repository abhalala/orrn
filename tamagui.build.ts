import { defineConfig } from "@tamagui/vite-plugin";

export default defineConfig({
  config: "packages/design/src/tamagui.config.ts",
  components: ["tamagui", "@orrn/ui"],
  outputCSS: "apps/web/src/tamagui.generated.css",
});
