import { defaultConfig } from "@tamagui/config/v4";
import { createTamagui } from "tamagui";

import { brand, neutrals } from "./tokens";

/**
 * Tamagui config for ORRN. We start from `@tamagui/config/v4` so we get the
 * full default token set (spacing, sizes, radius, fonts, animations) and then
 * overlay our brand + neutral surface palette into the `light` and `dark`
 * themes so any consumer using semantic tokens like `$background`,
 * `$borderColor`, `$color` automatically picks up our brand look.
 *
 * Components in `@orrn/ui` reference these semantic tokens (not raw hex) so
 * dark / light switching keeps working.
 */
const baseConfig = defaultConfig;

const lightTheme = {
  ...baseConfig.themes.light,
  background: neutrals.light.bg,
  backgroundHover: neutrals.light.bgMuted,
  backgroundPress: neutrals.light.bgMuted,
  backgroundFocus: neutrals.light.bgMuted,
  backgroundStrong: neutrals.light.bgElevated,
  backgroundTransparent: "transparent",
  color: neutrals.light.fg,
  colorHover: neutrals.light.fg,
  colorPress: neutrals.light.fg,
  colorFocus: neutrals.light.fg,
  colorTransparent: "transparent",
  borderColor: neutrals.light.border,
  borderColorHover: neutrals.light.borderStrong,
  borderColorPress: neutrals.light.borderStrong,
  borderColorFocus: brand.primary,
  placeholderColor: neutrals.light.fgSubtle,
  // Brand-specific semantic slots referenced directly by some components.
  primary: brand.primary,
  primaryHover: brand.primaryStrong,
  primaryFg: brand.primaryFg,
  accent: brand.accent,
  accentFg: brand.accentFg,
  muted: neutrals.light.bgMuted,
  mutedFg: neutrals.light.fgMuted,
  surface: neutrals.light.bgElevated,
};

const darkTheme = {
  ...baseConfig.themes.dark,
  background: neutrals.dark.bg,
  backgroundHover: neutrals.dark.bgMuted,
  backgroundPress: neutrals.dark.bgMuted,
  backgroundFocus: neutrals.dark.bgMuted,
  backgroundStrong: neutrals.dark.bgElevated,
  backgroundTransparent: "transparent",
  color: neutrals.dark.fg,
  colorHover: neutrals.dark.fg,
  colorPress: neutrals.dark.fg,
  colorFocus: neutrals.dark.fg,
  colorTransparent: "transparent",
  borderColor: neutrals.dark.border,
  borderColorHover: neutrals.dark.borderStrong,
  borderColorPress: neutrals.dark.borderStrong,
  borderColorFocus: brand.primary,
  placeholderColor: neutrals.dark.fgSubtle,
  primary: brand.primary,
  primaryHover: brand.primaryStrong,
  primaryFg: brand.primaryFg,
  accent: brand.accent,
  accentFg: brand.accentFg,
  muted: neutrals.dark.bgMuted,
  mutedFg: neutrals.dark.fgMuted,
  surface: neutrals.dark.bgElevated,
};

export const tamaguiConfig: ReturnType<typeof createTamagui> = createTamagui({
  ...baseConfig,
  themes: {
    ...baseConfig.themes,
    light: lightTheme,
    dark: darkTheme,
  },
});

export default tamaguiConfig;

export type OrrnTamaguiConfig = typeof tamaguiConfig;

declare module "tamagui" {
  interface TamaguiCustomConfig extends OrrnTamaguiConfig {}
}
