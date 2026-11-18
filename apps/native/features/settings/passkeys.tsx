import { useT, type MessageKey } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, Platform, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { nativePasskey, needsSignInAgain, PasskeyFailure, passkeyButtonShown } from "@/lib/passkey";
import { signOut } from "@/lib/sign-out";
import { useFormat } from "@/lib/use-format";
import { ME_QUERY_KEY } from "@/lib/session";
import { queryClient, trpc } from "@/utils/trpc";

/** The name the new passkey gets in the list: the device, a proper name the same in every language (as the web names them). */
function deviceName(): string {
  if (Platform.OS === "ios") return Platform.isPad ? "iPad" : "iPhone";
  return "Android";
}

/**
 * Settings > Passkeys on the phone (plan 2026-11-18, Task 6). Lists the person's passkeys and adds one for
 * this phone. Floor phones are shared, so adding is never offered anywhere else and always asks "Is this
 * your own phone?" first: anyone who can unlock the phone could use its passkey. Shown only when the
 * phone can use passkeys and the server has this platform's association; renaming and removing stay on
 * the web (Settings > Sign-in there), where the last-way-in rules are explained.
 */
export function PasskeysSection() {
  const { t } = useT();
  const format = useFormat();
  const signInMethods = useQuery(trpc.auth.signInMethods.queryOptions());
  const methods = useQuery({ ...trpc.auth.methods.queryOptions(), staleTime: Infinity, retry: false });
  const [deviceSupported, setDeviceSupported] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ key: MessageKey; tone: "ok" | "error" } | null>(null);
  /** The add needs a fresh sign-in (session over a day old): offer "Sign in again" under the message. */
  const [offerSignIn, setOfferSignIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let live = true;
    void nativePasskey.supported().then((yes) => {
      if (live) setDeviceSupported(yes);
    });
    return () => {
      live = false;
    };
  }, []);

  const canAdd = passkeyButtonShown({ deviceSupported, methods: methods.data, platform: Platform.OS });
  const passkeys = signInMethods.data?.passkeys ?? [];

  function say(key: MessageKey, tone: "ok" | "error") {
    setMessage({ key, tone });
    announce(t(key), { shownInLiveRegion: true });
  }

  async function add() {
    setAdding(true);
    setMessage(null);
    setOfferSignIn(false);
    try {
      await nativePasskey.add(deviceName());
      feedback.success();
      say("settings.signIn.passkeyAdded", "ok");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.auth.signInMethods.queryKey() }),
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY, exact: true }),
      ]);
    } catch (thrown) {
      const failure = thrown instanceof PasskeyFailure ? thrown : new PasskeyFailure("auth.errors.passkeyAddFailed");
      if (!failure.cancelled) feedback.error();
      say(failure.messageKey, "error");
      setOfferSignIn(needsSignInAgain(failure));
    } finally {
      setAdding(false);
    }
  }

  function confirmOwnPhone() {
    if (adding) return;
    Alert.alert(t("native.passkey.ownPhoneTitle"), t("native.passkey.ownPhoneBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("native.passkey.ownPhoneConfirm"), onPress: () => void add() },
    ]);
  }

  return (
    <View className="gap-4 rounded-card border border-hairline bg-surface p-5">
      <View className="gap-1">
        <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
          {t("settings.signIn.passkeys")}
        </Text>
        <Text className="font-sans text-sm text-ink-muted">{t("settings.signIn.passkeysHint")}</Text>
      </View>

      {signInMethods.data === undefined ? (
        signInMethods.isError ? (
          <ErrorBlock error={signInMethods.error} onRetry={() => void signInMethods.refetch()} retrying={signInMethods.isFetching} />
        ) : (
          <LoadingBlock />
        )
      ) : passkeys.length === 0 ? (
        <Text className="font-sans text-base text-ink">{t("settings.signIn.noPasskeys")}</Text>
      ) : (
        <View className="gap-3">
          {passkeys.map((p) => {
            const name = p.name ?? t("settings.signIn.passkeyUnnamed");
            const added = t("settings.signIn.added", { date: format.day(p.createdAt) ?? "" });
            return (
              <View key={p.id} accessible accessibilityLabel={`${name}, ${added}`} className="min-h-11 gap-0.5">
                <Text className="font-sans-semibold text-base text-ink">{name}</Text>
                <Text className="font-sans text-sm text-ink-muted">{added}</Text>
              </View>
            );
          })}
          <Text className="font-sans text-sm text-ink-muted">{t("native.passkey.manageOnWeb")}</Text>
        </View>
      )}

      {message ? (
        <Text
          accessibilityRole={message.tone === "error" ? "alert" : "text"}
          accessibilityLiveRegion="polite"
          className={
            message.tone === "error"
              ? "rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink"
              : "font-sans-medium text-[15px] leading-6 text-ink"
          }
        >
          {t(message.key)}
        </Text>
      ) : null}

      {offerSignIn ? (
        <Button
          variant="secondary"
          label={t("settings.signIn.signInAgain")}
          loading={signingOut}
          loadingLabel={t("native.signingOut")}
          onPress={() => {
            // The usual sign-out: the gate lands on the sign-in screen; a fresh sign-in can add the passkey.
            setSigningOut(true);
            void signOut();
          }}
        />
      ) : null}

      {canAdd ? (
        <Button variant="secondary" label={t("settings.signIn.addPasskey")} loading={adding} onPress={confirmOwnPhone} />
      ) : methods.data ? (
        <Text className="font-sans text-sm text-ink-muted">{t("native.passkey.unavailable")}</Text>
      ) : null}
    </View>
  );
}
