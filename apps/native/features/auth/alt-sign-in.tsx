import Feather from "@expo/vector-icons/Feather";
import { useT, type MessageKey } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { FadeIn } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { Button } from "@/components/ui/button";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { GOOGLE_MARK_PATHS } from "@/lib/google-mark";
import { signInWithGoogle } from "@/lib/google-sign-in";
import { AnimatedView } from "@/lib/nativewind-interop";
import { nativePasskey, PasskeyFailure, passkeyButtonShown } from "@/lib/passkey";
import { useThemeColor } from "@/lib/theme";
import { trpc } from "@/utils/trpc";

export type AltSignInProps = {
  /** The same finish as the password sign-in (`afterSignIn`: fresh `auth.me`, then Today or the plant picker). */
  finish: () => Promise<void>;
  /** The message to show (owned by the screen, so a password attempt clears it). */
  error: MessageKey | null;
  onError: (key: MessageKey | null) => void;
  /** The password step is working: these wait. */
  disabled?: boolean;
};

/** Google's "G" on a white disc, the mark its sign-in guidelines ask for (lib/google-mark.ts). */
function GoogleMark() {
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="size-6 items-center justify-center rounded-full bg-white">
      <Svg viewBox="0 0 48 48" width={16} height={16}>
        {GOOGLE_MARK_PATHS.map((path) => (
          <Path key={path.fill} fill={path.fill} d={path.d} />
        ))}
      </Svg>
    </View>
  );
}

/**
 * "Sign in with a passkey" and "Continue with Google" on the phone (plan 2026-11-18, Task 6). The owner's
 * ruling (R5): they stand level with the email + password form, the same size and style as its button,
 * under an "or". Each shows only where it can work: the passkey button when the phone can use passkeys AND
 * the server has this platform's association (`auth.methods.native`), Google when the stage has it. A
 * cancelled sheet or a refused Google account is an inline, announced message; the form stays usable. This
 * component never adds a passkey: that is Settings only, after "Is this your own phone?".
 */
export function AltSignIn({ finish, error, onError, disabled = false }: AltSignInProps) {
  const { t } = useT();
  const onPrimary = useThemeColor("card");
  // A failed read only hides these (the password form still works); the sign-in screen shows no global error.
  const methods = useQuery({ ...trpc.auth.methods.queryOptions(), staleTime: Infinity, retry: false });
  const [deviceSupported, setDeviceSupported] = useState(false);
  const [busy, setBusy] = useState<"passkey" | "google" | null>(null);

  useEffect(() => {
    let live = true;
    void nativePasskey.supported().then((yes) => {
      if (live) setDeviceSupported(yes);
    });
    return () => {
      live = false;
    };
  }, []);

  const passkey = passkeyButtonShown({ deviceSupported, methods: methods.data, platform: Platform.OS });
  const google = methods.data?.google === true;

  function fail(key: MessageKey, quiet = false) {
    onError(key);
    announce(t(key), { shownInLiveRegion: true });
    if (!quiet) feedback.error();
  }

  async function signInWithPasskey() {
    if (busy) return;
    onError(null);
    setBusy("passkey");
    try {
      await nativePasskey.signIn();
      feedback.success();
      await finish();
    } catch (thrown) {
      if (thrown instanceof PasskeyFailure) fail(thrown.messageKey, thrown.cancelled);
      else fail("errors.network");
    } finally {
      setBusy(null);
    }
  }

  async function continueWithGoogle() {
    if (busy) return;
    onError(null);
    setBusy("google");
    try {
      const outcome = await signInWithGoogle();
      if (outcome.step === "error") return fail(outcome.messageKey);
      if (outcome.step === "done") {
        feedback.success();
        await finish();
      }
    } catch {
      fail("errors.network");
    } finally {
      setBusy(null);
    }
  }

  if (!passkey && !google && !error) return null;

  return (
    <View className="gap-3">
      {passkey || google ? (
        <View className="flex-row items-center gap-3" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View className="h-px flex-1 bg-hairline" />
          <Text className="font-sans text-sm text-ink-muted">{t("auth.login.or")}</Text>
          <View className="h-px flex-1 bg-hairline" />
        </View>
      ) : null}
      {passkey ? (
        <Button
          size="lg"
          label={t("auth.login.passkey")}
          loading={busy === "passkey"}
          disabled={disabled || busy === "google"}
          icon={<Feather name="key" size={18} color={onPrimary} importantForAccessibility="no" />}
          onPress={() => void signInWithPasskey()}
        />
      ) : null}
      {google ? (
        <Button
          size="lg"
          label={t("auth.login.google")}
          loading={busy === "google"}
          disabled={disabled || busy === "passkey"}
          icon={<GoogleMark />}
          onPress={() => void continueWithGoogle()}
        />
      ) : null}
      {error ? (
        <AnimatedView entering={FadeIn.duration(150)}>
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink"
          >
            {t(error)}
          </Text>
        </AnimatedView>
      ) : null}
    </View>
  );
}
