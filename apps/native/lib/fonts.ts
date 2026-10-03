/**
 * C2 typefaces for native: Bricolage Grotesque (display), Geist (body) and
 * Geist Mono (numbers, codes). Self-hosted through `expo-font`, so nothing is
 * fetched at runtime.
 *
 * The keys are the exact font-family names `tailwind.config.js` exposes as
 * `font-display*`, `font-sans*` and `font-mono*`. React Native cannot pick a
 * weight out of a custom family, so each weight is its own family name.
 *
 * Import individual weights, never the package index: the index `require`s
 * every weight and Metro would bundle all of them.
 */
export const fontAssets = {
  BricolageGrotesque_600SemiBold: require("@expo-google-fonts/bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf"),
  BricolageGrotesque_700Bold: require("@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf"),
  BricolageGrotesque_800ExtraBold: require("@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf"),
  Geist_400Regular: require("@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf"),
  Geist_500Medium: require("@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf"),
  Geist_600SemiBold: require("@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf"),
  Geist_700Bold: require("@expo-google-fonts/geist/700Bold/Geist_700Bold.ttf"),
  GeistMono_400Regular: require("@expo-google-fonts/geist-mono/400Regular/GeistMono_400Regular.ttf"),
  GeistMono_500Medium: require("@expo-google-fonts/geist-mono/500Medium/GeistMono_500Medium.ttf"),
  GeistMono_600SemiBold: require("@expo-google-fonts/geist-mono/600SemiBold/GeistMono_600SemiBold.ttf"),
} as const;

export type FontFamilyName = keyof typeof fontAssets;
