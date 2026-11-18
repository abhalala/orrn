import { useT, type MessageKey } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Text, View, type TextInput as InputRef } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ScreenTitle } from "@/components/ui/screen-title";
import { LoadingBlock } from "@/components/ui/state";
import { AltSignIn, OrLine, useAltSignInButtons } from "@/features/auth/alt-sign-in";
import { inviteAcceptOutcome, inviteScreen, inviteSignUpRefusal, isExistingAccount, type InviteOutcome, type InviteStatus } from "@/features/invite/invite-flow";
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Join a company from an invite link (audit N4; plan 2026-11-18, Task 8: every invite state has a way
 * in). `invite.status` says whether the link is live and what the invited email's account needs,
 * without the email, the company or the role. Nothing is accepted until the person taps.
 *
 * - Signed in on this phone: one button joins with this account.
 * - No account for the invite email: name, email and password (or Google), then join.
 * - An account with a password: sign in (passkey, Google, or email and password), then join.
 * - An account with no password (a magic-link approval, Google or a passkey only): a way it already
 *   has, or "Email me a link to set a password" (sent only to the invite's own email; the link opens
 *   the web invite page after the reset).
 */
export default function InviteScreen() {
  const { t } = useT();
  const { token } = useLocalSearchParams<{ token: string }>();
  const hasSession = useSyncExternalStore(sessionPresence.subscribe, sessionPresence.get);
  // `invite.status` is a mutation (a POST), so the token stays out of URLs and request logs; read here
  // as a query. Read again when the app comes back to the front (focusManager follows AppState,
  // app/_layout.tsx): after setting a password in the browser, the screen offers sign-in.
  const statusCall = trpc.invite.status.mutationOptions();
  const status = useQuery({
    queryKey: ["invite", "status", token ?? ""],
    queryFn: () => statusCall.mutationFn!({ token: token ?? "" }, undefined as never),
    enabled: Boolean(token),
    retry: false,
  });
  // An accept or a sign-up that found the link dead since it was read.
  const [expired, setExpired] = useState(false);
  const screen = expired
    ? "expired"
    : inviteScreen(hasSession, status.data ? (status.data as InviteStatus) : status.isError ? "failed" : "pending");
  const markExpired = useCallback(() => setExpired(true), []);

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
        {!token || screen === "expired" ? (
          <Notice text={t("auth.invite.expired")} />
        ) : screen === "checking" ? (
          <View className="gap-3">
            <LoadingBlock />
            <Text className="text-center font-sans text-base text-ink-muted">{t("native.invite.checking")}</Text>
          </View>
        ) : screen === "failed" ? (
          <Notice text={t("native.invite.failed")}>
            <Button size="lg" variant="secondary" label={t("native.invite.tryAgain")} onPress={() => void status.refetch()} />
          </Notice>
        ) : screen === "join" ? (
          <SignedInInvite token={token} />
        ) : screen === "signIn" ? (
          <SignInInvite token={token} onExpired={markExpired} />
        ) : screen === "noPassword" ? (
          <NoPasswordInvite token={token} onExpired={markExpired} />
        ) : (
          <CreateInvite token={token} google={status.data?.live === true && status.data.google} onExpired={markExpired} />
        )}
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

function Info({ text }: { text: string }) {
  return (
    <Text accessibilityLiveRegion="polite" className="rounded-input bg-tone-blue-tint px-4 py-3 font-sans-medium text-[15px] leading-6 text-tone-blue-ink">
      {text}
    </Text>
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

/**
 * Accept after a sign-in on this screen, then finish. A dead link turns the screen to the expired
 * notice; any other failure is said in place.
 */
function useAcceptAfterSignIn(token: string, onExpired: () => void) {
  const { t } = useT();
  const finish = useFinish();
  const accept = useMutation(trpc.invite.acceptByToken.mutationOptions());
  const [failure, setFailure] = useState<Failure | null>(null);
  const run = useCallback(
    async (name?: string) => {
      setFailure(null);
      try {
        await accept.mutateAsync({ token, name });
      } catch (error) {
        const { outcome, failure: f } = outcomeFailure(t, error);
        if (outcome === "expired") return onExpired();
        setFailure(f);
        announce(f.text, { shownInLiveRegion: true });
        feedback.error();
        return;
      }
      await finish();
    },
    [accept, finish, onExpired, t, token],
  );
  return { run, failure, setFailure, finish };
}

function FailureNotice({ failure, onCheck }: { failure: Failure | null; onCheck(): void }) {
  const { t } = useT();
  if (!failure) return null;
  return (
    <Notice text={failure.text}>
      {failure.unsure ? <Button variant="secondary" label={t("native.invite.checkAccount")} onPress={onCheck} /> : null}
    </Notice>
  );
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
      <FailureNotice failure={failure} onCheck={() => void finish()} />
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

/** No account for the invite email: name, email and password, then join; Google too where it works. */
function CreateInvite({ token, google, onExpired }: { token: string; google: boolean; onExpired(): void }) {
  const { t } = useT();
  const { run, failure, finish } = useAcceptAfterSignIn(token, onExpired);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: MessageKey; email?: MessageKey; password?: MessageKey }>({});
  const [formFailure, setFormFailure] = useState<Failure | null>(null);
  const [altError, setAltError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);

  function fail(text: string) {
    setFormFailure({ text });
    announce(text, { shownInLiveRegion: true });
    feedback.error();
  }

  async function submit() {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "errors.required";
    if (!email.trim()) next.email = "errors.required";
    else if (!EMAIL.test(email.trim())) next.email = "errors.invalidEmail";
    if (!password) next.password = "errors.required";
    else if (password.length < 8) next.password = "auth.invite.passwordHint";
    setErrors(next);
    setFormFailure(null);
    const first = next.name ?? next.email ?? next.password;
    if (first) {
      announce(t(first), { shownInLiveRegion: true });
      feedback.error();
      return;
    }

    setBusy(true);
    try {
      const cleanEmail = email.trim();
      // The server makes an account only for the invited email, from a live invite (sign-up-guard.ts).
      // Better Auth's client types list only its own fields, so the body is a named object.
      const body = { email: cleanEmail, password, name: name.trim(), inviteToken: token };
      const created = await authClient.signUp.email(body);
      if (created.error) {
        const refused = inviteSignUpRefusal(created.error);
        if (refused === "expired") return onExpired();
        if (refused === "wrongEmail") return fail(t("native.invite.wrongEmail"));
        // The account turned up since the link was read: sign in instead.
        if (isExistingAccount(created.error)) return setExistingEmail(cleanEmail);
        const status = created.error.status;
        return fail(t(status === 429 ? "native.tooManyTries" : !status ? "errors.network" : "errors.generic"));
      }
      await run(name.trim());
    } catch {
      fail(t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  if (existingEmail !== null) return <SignInInvite token={token} onExpired={onExpired} defaultEmail={existingEmail} />;

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
      <FailureNotice failure={formFailure ?? failure} onCheck={() => void finish()} />
      <Button size="lg" label={t("auth.invite.submit")} loading={busy} loadingLabel={t("native.invite.joining")} onPress={() => void submit()} />
      {/* Google makes the account only for an email with a live invite and accepts it on the way in. */}
      {google ? <AltSignIn passkey={false} finish={() => run()} error={altError} onError={setAltError} disabled={busy} /> : null}
    </View>
  );
}

/** The invite email has an account with a password: sign in (any way it has), then join. */
function SignInInvite({ token, onExpired, defaultEmail = "" }: { token: string; onExpired(): void; defaultEmail?: string }) {
  const { t } = useT();
  const router = useRouter();
  const { run, failure, finish } = useAcceptAfterSignIn(token, onExpired);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: MessageKey; password?: MessageKey }>({});
  const [formFailure, setFormFailure] = useState<Failure | null>(null);
  const [altError, setAltError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const passwordRef = useRef<InputRef>(null);

  function fail(text: string) {
    setFormFailure({ text });
    announce(text, { shownInLiveRegion: true });
    feedback.error();
  }

  async function submit() {
    const next: typeof errors = {};
    if (!email.trim()) next.email = "errors.required";
    else if (!EMAIL.test(email.trim())) next.email = "errors.invalidEmail";
    if (!password) next.password = "errors.required";
    setErrors(next);
    setFormFailure(null);
    setAltError(null);
    const first = next.email ?? next.password;
    if (first) {
      announce(t(first), { shownInLiveRegion: true });
      feedback.error();
      return;
    }
    setBusy(true);
    try {
      const outcome = afterPassword(await authClient.signIn.email({ email: email.trim(), password }));
      if (outcome.step === "error") return fail(t(outcome.messageKey));
      if (outcome.step === "totp") return setTwoFactor(true);
      await run();
    } catch {
      fail(t("errors.network"));
    } finally {
      setBusy(false);
    }
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
      <Info text={t("auth.invite.existingAccount")} />
      <View className="gap-4">
        <Field
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
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
          }}
          error={errors.password ? t(errors.password) : null}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          editable={!busy}
        />
      </View>
      <FailureNotice failure={formFailure ?? failure} onCheck={() => void finish()} />
      <Button size="lg" label={t("auth.invite.signInSubmit")} loading={busy} loadingLabel={t("native.invite.joining")} onPress={() => void submit()} />
      <AltSignIn finish={() => run()} error={altError} onError={setAltError} disabled={busy} />
    </View>
  );
}

/**
 * The invite email has an account with no password. A passkey or Google first where they can work
 * (the account may have one), then "Email me a link to set a password", sent only when the typed email
 * is the invite's (`invite.sendSetPasswordLink`; the answer is the same either way). The link opens the
 * web invite page after the reset, where the person signs in and joins.
 */
function NoPasswordInvite({ token, onExpired }: { token: string; onExpired(): void }) {
  const { t } = useT();
  // After the link went: the person sets the password in the browser, then signs in here.
  const [signIn, setSignIn] = useState(false);
  const buttons = useAltSignInButtons();
  const { run, failure, finish } = useAcceptAfterSignIn(token, onExpired);
  const send = useMutation(trpc.invite.sendSetPasswordLink.mutationOptions());
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<MessageKey | null>(null);
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [altError, setAltError] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    const clean = email.trim();
    setFormError(null);
    if (!clean || !EMAIL.test(clean)) {
      const key: MessageKey = clean ? "errors.invalidEmail" : "errors.required";
      setEmailError(key);
      announce(t(key), { shownInLiveRegion: true });
      feedback.error();
      return;
    }
    setEmailError(null);
    try {
      await send.mutateAsync({ token, email: clean });
      setSent(true);
      announce(t("auth.invite.setPasswordSent"));
    } catch (error) {
      const code = (error as { data?: { code?: unknown } | null }).data?.code;
      const key: MessageKey = code === "TOO_MANY_REQUESTS" ? "native.tooManyTries" : "errors.network";
      setFormError(key);
      announce(t(key), { shownInLiveRegion: true });
      feedback.error();
    }
  }

  const anyButton = buttons.passkey || buttons.google;

  if (signIn) return <SignInInvite token={token} onExpired={onExpired} defaultEmail={email.trim()} />;

  return (
    <View className="gap-6">
      <Info text={`${t("auth.invite.noPasswordTitle")} ${t("auth.invite.noPasswordBody")}`} />
      <FailureNotice failure={failure} onCheck={() => void finish()} />
      {anyButton ? <AltSignIn divider={false} finish={() => run()} error={altError} onError={setAltError} /> : null}
      {anyButton ? <OrLine /> : null}
      {sent ? (
        <View className="gap-4">
          <Text accessibilityLiveRegion="polite" className="font-sans text-base leading-6 text-ink">
            {t("auth.invite.setPasswordSent")}
          </Text>
          <Text className="font-sans text-base leading-6 text-ink-muted">{t("native.invite.afterSetPassword")}</Text>
          <Button size="lg" label={t("native.invite.signInNow")} onPress={() => setSignIn(true)} />
        </View>
      ) : (
        <View className="gap-4">
          <View className="gap-1">
            <Text accessibilityRole="header" className="font-sans-semibold text-lg text-ink">
              {t("auth.invite.setPasswordLead")}
            </Text>
            <Text className="font-sans text-base leading-6 text-ink-muted">{t("auth.invite.setPasswordHint")}</Text>
          </View>
          <Field
            label={t("auth.invite.email")}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (emailError) setEmailError(null);
            }}
            error={emailError ? t(emailError) : null}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            editable={!send.isPending}
          />
          {formError ? <Notice text={t(formError)} /> : null}
          <Button
            size="lg"
            variant={anyButton ? "secondary" : undefined}
            label={t("auth.invite.setPasswordSubmit")}
            loading={send.isPending}
            loadingLabel={t("auth.invite.setPasswordSending")}
            onPress={() => void submit()}
          />
        </View>
      )}
    </View>
  );
}
