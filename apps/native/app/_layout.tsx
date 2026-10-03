import "@/global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ImpersonationBanner } from "@/components/impersonation-banner";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { EdgeNodeProvider } from "@/contexts/edge-node-context";
import { fontAssets } from "@/lib/fonts";
import { useMe } from "@/utils/me";
import { queryClient } from "@/utils/trpc";

// Keep the splash screen up until the C2 typefaces are ready.
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: "(drawer)",
};

/**
 * Watches `me.company.id` for changes and clears React Query cache on switch.
 * Native parity for the web TenantCacheGuard.
 */
function TenantCacheGuard() {
  const { data: me } = useMe();
  const lastCompanyIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const next = me?.company?.id ?? null;
    const prev = lastCompanyIdRef.current;
    if (prev === undefined) {
      lastCompanyIdRef.current = next;
      return;
    }
    if (prev !== next) {
      queryClient.removeQueries({
        predicate: (q) => {
          const head = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
          if (typeof head === "string" && head.startsWith("auth")) return false;
          return true;
        },
      });
      lastCompanyIdRef.current = next;
    }
  }, [me?.company?.id]);

  return null;
}

function StackLayout() {
  return (
    <>
      <ImpersonationBanner />
      <TenantCacheGuard />
      <Stack screenOptions={{}}>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function Layout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const fontsReady = fontsLoaded || fontError != null;

  useEffect(() => {
    // A font error must not brick the app: fall back to system fonts.
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <EdgeNodeProvider>
              <StackLayout />
            </EdgeNodeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
