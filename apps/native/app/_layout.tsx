import "@/global.css";
import "@/lib/nativewind-interop";

import { I18nProvider, useT } from "@orrn/i18n";
import type { Me } from "@orrn/server/lib/permissions";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colorScheme } from "nativewind";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { MessageScreen } from "@/components/message-screen";
import { TenantCacheGuard } from "@/components/tenant-cache-guard";
import { Button } from "@/components/ui/button";
import { fontAssets } from "@/lib/fonts";
import { resolveGate, ROOT_ROUTES, type GateState } from "@/lib/gate";
import { GateContext } from "@/lib/gate-context";
import { readInitialLocale, storeLocale } from "@/lib/locale-store";
import { useStackOptions } from "@/lib/screen-options";
import { shouldRetryQuery } from "@/lib/session";
import { sessionPresence } from "@/lib/session-presence";
import { useThemeColor } from "@/lib/theme";
import { meQueryOptions } from "@/utils/me";
import { queryClient } from "@/utils/trpc";

// A link that cold-starts the app (an invite) opens on top of "/", so Back
// lands on the gate's choice instead of leaving a lone screen with no way out.
export const unstable_settings = { initialRouteName: "index" };

// Keep the splash up until the C2 typefaces are loaded and the gate has decided.
void SplashScreen.preventAutoHideAsync();
// The manual theme toggle is gone (audit N15): follow the device.
colorScheme.set("system");

/** Per-device language: SecureStore `orrn.locale`, else the device language. */
function LocaleProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readInitialLocale);
  return (
    <I18nProvider locale={initial} onLocaleChange={storeLocale}>
      {children}
    </I18nProvider>
  );
}

function LoadingScreen() {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  return (
    <View className="flex-1 items-center justify-center bg-canvas" accessible accessibilityLabel={t("common.loading")}>
      <ActivityIndicator color={ink} />
    </View>
  );
}

function OfflineScreen({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { t } = useT();
  return (
    <MessageScreen title={t("native.offlineTitle")} body={t("native.offlineBody")}>
      <Button size="lg" label={t("common.retry")} loading={retrying} onPress={onRetry} />
    </MessageScreen>
  );
}

/**
 * The auth gate (audit N3). `resolveGate` decides once; each group of screens
 * sits in a `Stack.Protected` whose guard is that decision, so a deep link to
 * a tab while signed out lands on sign-in, and signing in or out moves the
 * person without any manual `router.replace`. Screen lists come from
 * `ROOT_ROUTES` (a test fails if a screen exists outside them).
 */
function RootNavigator() {
  const hasSession = useSyncExternalStore(sessionPresence.subscribe, sessionPresence.get);
  // One retry, not three: an offline cold start reaches the offline screen in a second or two.
  const me = useQuery({ ...meQueryOptions(), enabled: hasSession, retry: (n, e) => n < 1 && shouldRetryQuery(n, e) });
  const state: GateState = resolveGate({
    hasSession,
    me: me.data as Me | undefined,
    error: me.error,
    isPending: me.isPending,
  });
  const stackOptions = useStackOptions();
  const { t } = useT();

  // First decision hides the splash; later loads (after sign-in) show a spinner instead.
  const [splashHidden, setSplashHidden] = useState(false);
  useEffect(() => {
    if (state !== "loading" && !splashHidden) {
      setSplashHidden(true);
      void SplashScreen.hideAsync();
    }
  }, [state, splashHidden]);

  if (state === "loading") return splashHidden ? <LoadingScreen /> : null;
  if (state === "offline") return <OfflineScreen onRetry={() => void me.refetch()} retrying={me.isFetching} />;

  // The gate swapping one world for another (cold start, sign-in, sign-out)
  // fades; only screens opened from inside the app (More) slide in.
  const gateSwap = { headerShown: false, animation: "fade" } as const;
  const pushed = { headerShown: false };
  return (
    <GateContext value={state}>
      <Stack screenOptions={stackOptions}>
        {/* `index` first and unguarded: it is the fallback when a guard flips. */}
        <Stack.Screen name="index" options={gateSwap} />
        <Stack.Protected guard={state === "/(tabs)/today"}>
          {ROOT_ROUTES.app.map((name) => (
            <Stack.Screen key={name} name={name} options={name === "(tabs)" ? gateSwap : pushed} />
          ))}
        </Stack.Protected>
        <Stack.Protected guard={state === "/(auth)/sign-in"}>
          {ROOT_ROUTES.auth.map((name) => (
            <Stack.Screen key={name} name={name} options={gateSwap} />
          ))}
        </Stack.Protected>
        <Stack.Protected guard={state === "/no-access"}>
          {ROOT_ROUTES.noAccess.map((name) => (
            <Stack.Screen key={name} name={name} options={gateSwap} />
          ))}
        </Stack.Protected>
        {ROOT_ROUTES.public
          .filter((name) => name !== "index")
          .map((name) => (
            <Stack.Screen key={name} name={name} options={{ title: t("auth.invite.genericTitle") }} />
          ))}
      </Stack>
    </GateContext>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  // A font error must not brick the app: fall back to system fonts.
  if (!fontsLoaded && fontError == null) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <LocaleProvider>
            <StatusBar style="auto" />
            <TenantCacheGuard />
            <RootNavigator />
          </LocaleProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
