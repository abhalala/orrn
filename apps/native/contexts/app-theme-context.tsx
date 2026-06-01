import { useColorScheme } from "nativewind";
import React, { createContext, useCallback, useContext, useMemo } from "react";

type ThemeName = "light" | "dark";

type AppThemeContextType = {
  currentTheme: ThemeName;
  isLight: boolean;
  isDark: boolean;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
};

const AppThemeContext = createContext<AppThemeContextType | undefined>(undefined);

/**
 * Bridges NativeWind's color-scheme state to the rest of the app. NativeWind
 * toggles the `dark` class on the JSX tree which drives every `dark:` Tailwind
 * variant + the CSS variables defined in `apps/native/global.css`.
 */
export const AppThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { colorScheme, setColorScheme, toggleColorScheme } = useColorScheme();

  const currentTheme: ThemeName = colorScheme === "light" ? "light" : "dark";
  const isLight = currentTheme === "light";
  const isDark = currentTheme === "dark";

  const setTheme = useCallback(
    (newTheme: ThemeName) => {
      setColorScheme(newTheme);
    },
    [setColorScheme],
  );

  const toggleTheme = useCallback(() => {
    toggleColorScheme();
  }, [toggleColorScheme]);

  const value = useMemo(
    () => ({ currentTheme, isLight, isDark, setTheme, toggleTheme }),
    [currentTheme, isLight, isDark, setTheme, toggleTheme],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
};

export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return context;
}
