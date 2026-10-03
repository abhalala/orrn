import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import * as React from "react";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

/** Canvas colours from `@orrn/ui/tokens` (c2.light.canvas / c2.dark.canvas). */
const THEME_COLOR = { light: "#f4f4f1", dark: "#0c0c0e" } as const;

/**
 * Keeps `<meta name="theme-color">` (browser chrome / mobile status bar) in
 * step with the resolved theme, including a manual light/dark override that
 * differs from the OS preference. index.html ships media-query defaults for
 * first paint; this rewrites them once next-themes resolves.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  React.useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = THEME_COLOR[resolvedTheme];
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = color;
    }
  }, [resolvedTheme]);
  return null;
}

export { useTheme } from "next-themes";
