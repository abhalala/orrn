import { useT, type MessageKey } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Text, View, type TextInput as InputRef } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ScreenTitle } from "@/components/ui/screen-title";
import { LoadingBlock } from "@/components/ui/state";
import { inviteAcceptOutcome, inviteProbeResult, isExistingAccount, type InviteOutcome } from "@/features/invite/invite-flow";
import { announce } from "@/lib/a11y";
import { authClient } from "@/lib/auth-client";
import { feedback } from "@/lib/feedback";
import { saveErrorText } from "@/lib/save-error";
import { sessionPresence } from "@/lib/session-presence";
import { afterPassword } from "@/lib/sign-in-flow";
import { afterSignIn, signOut } from "@/lib/sign-out";
import { useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

type Failure = { text: string; unsure?: boolean };

/**
 * Join a company from an invite link (audit N4). The link opens signed in or
 * out. Signed out, the invite is checked first (before anyone types a
 * password): a dead link says so at once. Then name, email and password:
 * a new email gets an account; an email that already has one (Better Auth's
 * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, or the older `USER_ALREADY_EXISTS`)
 * signs in with the typed password. Signed in, one button accepts the invite
 * for the account on this phone.
 */
export default function InviteScreen() {
  const { t } = useT();
  const { token } = useLocalSearchParams<{ token: string }>();
  const hasSession = useSyncExternalStore(sessionPresence.subscribe, sessionPresence.get);

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-canvas"
      contentContainerClassName="grow justify-between gap-10 px-4 pb-8 pt-6"
    >
      <View className="w-full max-w-[420px] gap-8 self-center">
        <BrandMark />
        <View className="gap-2">
          <ScreenTitle>{t("auth.invite.genericTitle")}</ScreenTitle>
        </View>
        {token ? hasSession ? <SignedInInvite token={token} /> : <SignedOutInvite token={token} /> : <Notice text={t("auth.invite.expired")} />}
      </View>
      <LanguageSwitch className="w-full max-w-[420px] self-center" />
    </KeyboardAwareScrollView>
  );
}

function Notice({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <View className="gap-4">
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="rounded-input bg-tone-red-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-red-ink"
      >
        {text}
      </Text>
      {children}
    </View>
  );
}

/** What each failed accept says. `failed` goes through saveErrorText: a timed-out save may have gone through. */
function outcomeFailure(t: ReturnType<typeof useT>["t"], error: unknown): { outcome: InviteOutcome; failure: Failure } {
  const outcome = inviteAcceptOutcome(error);
  if (outcome === "expired") return { outcome, failure: { text: t("auth.invite.expired") } };
  if (outcome === "wrongEmail") return { outcome, failure: { text: t("native.invite.wrongEmail") } };
  if (outcome === "signedOut") return { outcome, failure: { text: t("native.invite.signedOut") } };
  const save = saveErrorText(t, error);
  return { outcome, failure: { text: save.kind === "unsure" ? save.body : t("native.invite.failed"), unsure: save.kind === "unsure" } };
}

function useFinish() {
  const { t } = useT();
  const router = useRouter();
  return useCallback(async () => {
    feedback.success();
    announce(t("native.invite.joined"));
    // Loads auth.me with the new membership and tells the gate, then leaves this screen.
    await afterSignIn();
    router.replace("/");
  }, [router, t]);
}

function SignedInInvite({ token }: { token: string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const finish = useFinish();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const accept = useMutation(trpc.invite.acceptByToken.mutationOptions());
  const wrongEmail = failure?.text === t("native.invite.wrongEmail");

  async function submit() {
    setFailure(null);
    try {
      await accept.mutateAsync({ token });
      await finish();
    } catch (error) {
      const { failure: f } = outcomeFailure(t, error);
      setFailure(f);
      announce(f.text, { shownInLiveRegion: true });
      feedback.error();
    }
  }

  return (
    <View className="gap-6">
      <View className="gap-2">
        <Text className="font-sans-semibold text-lg text-ink">{t("native.invite.signedInTitle", { email: me?.user.email ?? "" })}</Text>
        <Text className="font-sans text-base leading-6 text-ink-muted">{t("native.invite.signedInBody")}</Text>
      </View>
      {failure ? (
        <Notice text={failure.text}>
          {failure.unsure ? <Button variant="secondary" label={t("native.invite.checkAccount")} onPress={() => void finish()} /> : null}
        </Notice>
      ) : null}
      <View className="gap-3">
        <Button size="lg" label={t("native.invite.accept")} loading={accept.isPending} loadingLabel={t("native.invite.joining")} onPress={() => void submit()} />
        {wrongEmail ? (
          <Button
            variant="secondary"
            label={t("native.invite.signOutOther")}
            loading={signingOut}
            loadingLabel={t("native.signingOut")}
            onPress={async () => {
              setSigningOut(true);
              await signOut();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

type Check = "checking" | "valid" | "expired" | "failed";

function SignedOutInvite({ token }: { token: string }) {
  const { t } = useT();
  const router = useRouter();
  const finish = useFinish();
  const probe = useMutation(trpc.invite.acceptByToken.mutationOptions());
  const accept = useMutation(trpc.invite.acceptByToken.mutationOptions());
  const [check, setCheck] = useState<Check>("checking");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: MessageKey; email?: MessageKey; password?: MessageKey }>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);

  // Signed out, acceptByToken looks the token up before it checks the session:
  // UNAUTHORIZED means the invite is live, NOT_FOUND or BAD_REQUEST that it is dead.
  const runCheck = useCallback(() => {
    setCheck("checking");
    probe.mutate(
      { token },
      {
        onSuccess: () => setCheck("valid"),
        onError: (error) => setCheck(inviteProbeResult(error)),
      },
    );
  }, [token]);
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  function fail(text: string, unsure = false) {
    setFailure({ text, unsure });
    announce(text, { shownInLiveRegion: true });
    feedback.error();
  }

  async function submit() {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "errors.required";
    if (!email.trim()) next.email = "errors.required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = "errors.invalidEmail";
    if (!password) next.password = "errors.required";
    else if (password.length < 8) next.password = "auth.invite.passwordHint";
    setErrors(next);
    setFailure(null);
    const first = next.name ?? next.email ?? next.password;
    if (first) {
      announce(t(first), { shownInLiveRegion: true });
      feedback.error();
      return;
    }

    setBusy(true);
    try {
      const cleanEmail = email.trim();
      const created = await authClient.signUp.email({ email: cleanEmail, password, name: name.trim() });
      if (created.error) {
        if (!isExistingAccount(created.error)) {
          const status = created.error.status;
          return fail(t(status === 429 ? "native.tooManyTries" : !status ? "errors.network" : "errors.generic"));
        }
        // This email already has an account: the typed password is its password.
        const outcome = afterPassword(await authClient.signIn.email({ email: cleanEmail, password }));
        if (outcome.step === "error") return fail(t(outcome.messageKey));
        if (outcome.step === "totp") {
          setTwoFactor(true);
          return;
        }
      }
      try {
        await accept.mutateAsync({ token, name: name.trim() });
      } catch (error) {
        const { outcome, failure: f } = outcomeFailure(t, error);
        if (outcome === "expired") setCheck("expired");
        else fail(f.text, f.unsure);
        return;
      }
      await finish();
    } catch {
      fail(t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  if (check === "checking") {
    return (
      <View className="gap-3">
        <LoadingBlock />
        <Text className="text-center font-sans text-base text-ink-muted">{t("native.invite.checking")}</Text>
      </View>
    );
  }
  if (check === "expired") return <Notice text={t("auth.invite.expired")} />;
  if (check === "failed") {
    return (
      <Notice text={t("native.invite.failed")}>
        <Button size="lg" variant="secondary" label={t("native.invite.tryAgain")} onPress={runCheck} />
      </Notice>
    );
  }
  if (twoFactor) {
    return (
      <Notice text={t("native.invite.twoFactor")}>
        <Button size="lg" label={t("native.invite.goSignIn")} onPress={() => router.replace("/")} />
      </Notice>
    );
  }

  return (
    <View className="gap-6">
      <Text className="font-sans text-base leading-6 text-ink-muted">{t("native.invite.subtitle")}</Text>
      <View className="gap-4">
        <Field
          label={t("auth.invite.name")}
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
          }}
          error={errors.name ? t(errors.name) : null}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          editable={!busy}
        />
        <Field
          ref={emailRef}
          label={t("auth.invite.email")}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
          }}
          error={errors.email ? t(errors.email) : null}
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
          label={t("auth.invite.password")}
          hint={t("auth.invite.passwordHint")}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
          }}
          error={errors.password ? t(errors.password) : null}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          editable={!busy}
        />
      </View>
      {failure ? (
        <Notice text={failure.text}>
          {failure.unsure ? <Button variant="secondary" label={t("native.invite.checkAccount")} onPress={() => void finish()} /> : null}
        </Notice>
      ) : null}
      <Button size="lg" label={t("auth.invite.submit")} loading={busy} loadingLabel={t("native.invite.joining")} onPress={() => void submit()} />
    </View>
  );
}
