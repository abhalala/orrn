import { useT, type MessageKey } from "@orrn/i18n";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { Text, View, type TextInput } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ScreenTitle } from "@/components/ui/screen-title";
import { announce } from "@/lib/a11y";
import { authClient } from "@/lib/auth-client";
import { AnimatedView } from "@/lib/nativewind-interop";
import { afterPassword, afterTotp, cleanTotp, totpInputError } from "@/lib/sign-in-flow";
import { afterSignIn } from "@/lib/sign-out";

type Step = "password" | "totp";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function haptic(kind: "success" | "error") {
  void Haptics.notificationAsync(
    kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
  ).catch(() => {});
}

/**
 * Email + password, then the authenticator code for 2FA accounts (audit N5).
 * No self sign-up (N15): people join by invite. On success the gate moves to
 * the tabs by itself; this screen never navigates.
 */
export default function SignInScreen() {
  const { t } = useT();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: MessageKey; password?: MessageKey }>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const passwordRef = useRef<TextInput>(null);

  /** Shows a form error. It renders in a live region, which Android reads by itself. */
  function fail(key: MessageKey) {
    setFormError(key);
    announce(t(key), { shownInLiveRegion: true });
    haptic("error");
  }

  async function submitPassword() {
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = "errors.required";
    else if (!looksLikeEmail(email)) errors.email = "errors.invalidEmail";
    if (!password) errors.password = "errors.required";
    setFieldErrors(errors);
    setFormError(null);
    const first = errors.email ?? errors.password;
    if (first) {
      // Shown under the field in a live region (components/ui/field.tsx).
      announce(t(first), { shownInLiveRegion: true });
      haptic("error");
      return;
    }

    setBusy(true);
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      const outcome = afterPassword(result);
      if (outcome.step === "error") return fail(outcome.messageKey);
      if (outcome.step === "totp") {
        setCode("");
        setStep("totp");
        announce(t("auth.totp.title"));
        return;
      }
      haptic("success");
      await afterSignIn();
    } catch {
      fail("errors.network");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    const short = totpInputError(code);
    if (short) return fail(short);
    setFormError(null);
    setBusy(true);
    try {
      // Floor phones are often shared, so this device is not remembered for 2FA.
      const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
      const outcome = afterTotp(result);
      if (outcome.step === "restart") {
        setStep("password");
        setPassword("");
        return fail(outcome.messageKey);
      }
      if (outcome.step === "error") {
        setCode("");
        return fail(outcome.messageKey);
      }
      haptic("success");
      await afterSignIn();
    } catch {
      fail("errors.network");
    } finally {
      setBusy(false);
    }
  }

  const title = step === "password" ? t("auth.login.title") : t("auth.totp.title");
  const subtitle = step === "password" ? t("auth.login.subtitle") : t("auth.totp.body");

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom", "left", "right"]}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="grow justify-between gap-10 px-4 pb-6 pt-8"
      >
        <View className="w-full max-w-[420px] gap-8 self-center">
          <BrandMark />

          <AnimatedView key={step} entering={FadeInDown.duration(250)} className="gap-6">
            <View className="gap-2">
              <ScreenTitle>{title}</ScreenTitle>
              <Text className="font-sans text-base leading-6 text-ink-muted">{subtitle}</Text>
            </View>

            {step === "password" ? (
              <View className="gap-4">
                <Field
                  label={t("auth.login.email")}
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v);
                    if (fieldErrors.email) setFieldErrors((e) => ({ ...e, email: undefined }));
                  }}
                  error={fieldErrors.email ? t(fieldErrors.email) : null}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="username"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  editable={!busy}
                />
                <Field
                  ref={passwordRef}
                  label={t("auth.login.password")}
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    if (fieldErrors.password) setFieldErrors((e) => ({ ...e, password: undefined }));
                  }}
                  error={fieldErrors.password ? t(fieldErrors.password) : null}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={() => void submitPassword()}
                  editable={!busy}
                />
              </View>
            ) : (
              <Field
                label={t("auth.totp.code")}
                value={code}
                onChangeText={(v) => setCode(cleanTotp(v))}
                mono
                inputClassName="text-center text-2xl tracking-[6px]"
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={() => void submitCode()}
                editable={!busy}
              />
            )}

            {formError ? (
              <AnimatedView entering={FadeIn.duration(150)}>
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink"
                >
                  {t(formError)}
                </Text>
              </AnimatedView>
            ) : null}

            {step === "password" ? (
              <Button
                size="lg"
                label={t("auth.login.submit")}
                loading={busy}
                loadingLabel={t("auth.login.submitting")}
                onPress={() => void submitPassword()}
              />
            ) : (
              <View className="gap-3">
                <Button
                  size="lg"
                  label={t("auth.totp.submit")}
                  loading={busy}
                  loadingLabel={t("native.verifying")}
                  disabled={code.length !== 6}
                  onPress={() => void submitCode()}
                />
                <Button
                  variant="ghost"
                  label={t("common.back")}
                  disabled={busy}
                  onPress={() => {
                    setStep("password");
                    setFormError(null);
                    setCode("");
                  }}
                />
              </View>
            )}
          </AnimatedView>
        </View>

        <LanguageSwitch className="w-full max-w-[420px] self-center" />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
