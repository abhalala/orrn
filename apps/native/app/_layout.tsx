import "@/global.css";
import { OrrnUiProvider } from "@orrn/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ImpersonationBanner } from "@/components/impersonation-banner";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { useMe } from "@/utils/me";
import { queryClient } from "@/utils/trpc";

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
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <OrrnUiProvider defaultTheme="dark">
              <HeroUINativeProvider>
                <StackLayout />
              </HeroUINativeProvider>
            </OrrnUiProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
