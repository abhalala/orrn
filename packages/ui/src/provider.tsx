import { tamaguiConfig } from "./tamagui.config";
import type { ReactNode } from "react";
import { TamaguiProvider, Theme } from "tamagui";

export function OrrnUiProvider({ children, defaultTheme = "dark" }: { children: ReactNode; defaultTheme?: "dark" | "light" }) {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={defaultTheme}>
      <Theme name={defaultTheme}>{children}</Theme>
    </TamaguiProvider>
  );
}
