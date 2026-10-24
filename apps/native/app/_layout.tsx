import "@/global.css";
import "@/lib/nativewind-interop";

import { I18nProvider, useT } from "@orrn/i18n";
import type { Me } from "@orrn/server/lib/permissions";
import { focusManager, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colorScheme } from "nativewind";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { MessageScreen } from "@/components/message-screen";
import { TenantCacheGuard } from "@/components/tenant-cache-guard";
import { Button } from "@/components/ui/button";
import { appStateFocus } from "@/lib/app-focus";
import { fontAssets } from "@/lib/fonts";
import { NESTED_STACKS, offlineKind, resolveGate, ROOT_ROUTES, type GateState } from "@/lib/gate";
import { GateContext } from "@/lib/gate-context";
import { readInitialLocale, storeLocale } from "@/lib/locale-store";
import { useStackOptions } from "@/lib/screen-options";
import { gateQueryRetry } from "@/lib/session";
import { sessionPresence } from "@/lib/session-presence";
import { signOut } from "@/lib/sign-out";
import { useThemeColor } from "@/lib/theme";
import { readThemePref } from "@/lib/theme-store";
import { meQueryOptions } from "@/utils/me";
import { queryClient } from "@/utils/trpc";

// A link that cold-starts the app (an invite) opens on top of "/", so Back
// lands on the gate's choice instead of leaving a lone screen with no way out.
export const unstable_settings = { initialRouteName: "index" };

// Keep the splash up until the C2 typefaces are loaded and the gate has decided.
void SplashScreen.preventAutoHideAsync();
// Colours follow the device unless Settings saved a choice (lib/theme-store.ts).
colorScheme.set(readThemePref());
// Coming back to the foreground refetches stale queries (auth.me included), as window focus does on web.
focusManager.setEventListener(appStateFocus(AppState));

/** The native splash never stays longer than this; a slow first auth.me shows a spinner instead. */
const SPLASH_MAX_MS = 2_000;

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

/**
 * No `auth.me` and no cached data. The copy follows the failure (a 5xx is
 * orrn's problem, not the phone's connection). After a retry has failed there
 * is a way out to another account: if one account's `auth.me` keeps failing,
 * a shared phone must not stay stuck until the session expires (SecureStore
 * survives a reinstall on iOS).
 */
function OfflineScreen({
  kind,
  failedFetches,
  onRetry,
  retrying,
}: {
  kind: ReturnType<typeof offlineKind>;
  /** auth.me fetches that failed; more than one means a retry failed too. */
  failedFetches: number;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { t } = useT();
  const [signingOut, setSigningOut] = useState(false);
  const server = kind === "server";
  return (
    <MessageScreen
      title={server ? t("native.serverTitle") : t("native.offlineTitle")}
      body={server ? t("native.serverBody") : t("native.offlineBody")}
    >
      <Button size="lg" label={t("common.retry")} loading={retrying} onPress={onRetry} />
      {failedFetches > 1 && !retrying ? (
        <Button
          size="lg"
          variant="secondary"
          label={t("auth.noAccess.switchAccount")}
          loading={signingOut}
          loadingLabel={t("native.signingOut")}
          onPress={async () => {
            setSigningOut(true);
            await signOut();
          }}
        />
      ) : null}
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
  // One retry, not three, and none after a timeout: every request gives up after
  // 10 s (lib/request-timeout.ts), so a dead uplink reaches the offline screen in
  // about 10 s instead of hanging on the splash until the OS gives up.
  const me = useQuery({ ...meQueryOptions(), enabled: hasSession, retry: gateQueryRetry });
  const state: GateState = resolveGate({
    hasSession,
    me: me.data as Me | undefined,
    error: me.error,
    isPending: me.isPending,
    failedFetches: me.errorUpdateCount,
  });
  const stackOptions = useStackOptions();
  const { t } = useT();
  // A retry clears `me.error` while it runs; keep the last one so the offline
  // copy (network or orrn) does not flip back and forth.
  const [lastError, setLastError] = useState<unknown>(null);
  useEffect(() => {
    if (me.error) setLastError(me.error);
  }, [me.error]);

  // The first decision hides the splash, and so does SPLASH_MAX_MS on a slow
  // network: the person then sees a spinner, not a frozen splash. Later loads
  // (after sign-in) show the spinner too.
  const [splashHidden, setSplashHidden] = useState(false);
  useEffect(() => {
    if (splashHidden) return;
    const hide = () => {
      setSplashHidden(true);
      void SplashScreen.hideAsync();
    };
    if (state !== "loading") {
      hide();
      return;
    }
    const timer = setTimeout(hide, SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, [state, splashHidden]);

  if (state === "loading") return splashHidden ? <LoadingScreen /> : null;
  if (state === "offline") {
    return (
      <OfflineScreen
        kind={offlineKind(me.error ?? lastError)}
        failedFetches={me.errorUpdateCount}
        onRetry={() => void me.refetch()}
        retrying={me.isFetching}
      />
    );
  }

  // The gate swapping one world for another (cold start, sign-in, sign-out)
  // fades; only screens opened from inside the app (More) slide in.
  const gateSwap = { headerShown: false, animation: "fade" } as const;
  // A nested Stack draws its own header (with HeaderBack); any other pushed
  // screen keeps this Stack's header, which carries the native Back.
  const pushed = (name: string) => (NESTED_STACKS.includes(name) ? { headerShown: false } : {});
  return (
    <GateContext value={state}>
      <Stack screenOptions={stackOptions}>
        {/* `index` first and unguarded: it is the fallback when a guard flips. */}
        <Stack.Screen name="index" options={gateSwap} />
        <Stack.Protected guard={state === "/(tabs)/today"}>
          {ROOT_ROUTES.app.map((name) => (
            <Stack.Screen key={name} name={name} options={name === "(tabs)" ? gateSwap : pushed(name)} />
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
