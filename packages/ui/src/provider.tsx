import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Web theme wrapper. Sets the `dark` class on `<html>` so Tailwind variants
 * (e.g. `dark:bg-card`) flip. Native apps don't import this — they wire their
 * own `nativewind` color-scheme provider inside `apps/native`.
 */
export function OrrnUiProvider({
  children,
  theme,
}: {
  children: ReactNode;
  /** Optional forced theme; if absent, follows system + user preference. */
  theme?: "dark" | "light" | "system";
}) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme={theme ?? "system"}
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}
