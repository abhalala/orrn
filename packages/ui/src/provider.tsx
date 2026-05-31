import { tamaguiConfig } from "./tamagui.config";
import type { ReactNode } from "react";
import { TamaguiProvider, Theme } from "tamagui";

export function OrrnUiProvider({
  children,
  theme = "dark",
}: {
  children: ReactNode;
  /** Active Tamagui theme; keep in sync with Uniwind on native. */
  theme?: "dark" | "light";
}) {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={theme}>
      <Theme name={theme}>{children}</Theme>
    </TamaguiProvider>
  );
}
