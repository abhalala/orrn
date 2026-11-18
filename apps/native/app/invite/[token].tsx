import { useT, type MessageKey } from "@orrn/i18n";
import { focusManager, useMutation, useQuery } from "@tanstack/react-query";
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
import { AltSignIn, OrLine, useAltSignInButtons } from "@/features/auth/alt-sign-in";
import {
  acceptAfterSignInWith,
  createFocusRecheck,
  inviteAcceptOutcome,
  inviteScreen,
  inviteSignUpRefusal,
  inviteStatusQueryOptions,
  isExistingAccount,
  offersSetPasswordLink,
  type InviteOutcome,
  type InviteStatus,
} from "@/features/invite/invite-flow";
import { useSetPasswordLink } from "@/features/invite/use-set-password-link";
import { announce } from "@/lib/a11y";
import { authClient } from "@/lib/auth-client";
import { feedback } from "@/lib/feedback";
import { saveErrorText } from "@/lib/save-error";
import { sessionPresence } from "@/lib/session-presence";
import { afterPassword } from "@/lib/sign-in-flow";
import { afterSignIn, signOut } from "@/lib/sign-out";
import { useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

/** `wrongEmail`: the accept named another account, so "Sign out" is offered (follows the outcome, not the words). */
type Failure = { text: string; unsure?: boolean; wrongEmail?: boolean };

/** A failed accept after a sign-in on this screen, handed to the signed-in view (council r1, B2). */
type Carried = { error: unknown };

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
 *
 * Any sign-in here is made known to the phone the usual way (`afterSignIn`), whatever the accept then
 * answers; one that turns out to be another account opens the signed-in view on "Sign out and use
 * another account" (council r1, B2).
 */
export default function InviteScreen() {
  const { t } = useT();
  const { token } = useLocalSearchParams<{ token: string }>();
  const hasSession = useSyncExternalStore(sessionPresence.subscribe, sessionPresence.get);
  // `invite.status` is a mutation (a POST), so the token stays out of URLs and request logs; read here
  // as a query, once (`inviteStatusQueryOptions`: plant phones share one IP against its limit). Only the
  // no-password view reads it again, on focus after the set-password link went (council r1, B3).
  const statusCall = trpc.invite.status.mutationOptions();
  const status = useQuery({
    queryKey: ["invite", "status", token ?? ""],
    queryFn: () => statusCall.mutationFn!({ token: token ?? "" }, undefined as never),
    enabled: Boolean(token),
    ...inviteStatusQueryOptions(),
  });
  const { refetch } = status;
  const recheck = useCallback(() => void refetch(), [refetch]);
  // An accept or a sign-up that found the link dead since it was read.
  const [expired, setExpired] = useState(false);
  const [carried, setCarried] = useState<Carried | null>(null);
  // The email the set-password link went to, for the sign-in step once the account has a password.
  const [knownEmail, setKnownEmail] = useState("");
  const screen = expired
    ? "expired"
    : inviteScreen(hasSession, status.data ? (status.data as InviteStatus) : status.isError ? "failed" : "pending", carried !== null);
  const markExpired = useCallback(() => setExpired(true), []);
  const carry = useCallback((c: Carried) => setCarried(c), []);
  const dropCarried = useCallback(() => setCarried(null), []);

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
          <SignedInInvite token={token} carried={carried} onSignedOut={dropCarried} />
        ) : screen === "signIn" ? (
          <SignInInvite token={token} onExpired={markExpired} defaultEmail={knownEmail} onCarry={carry} />
        ) : screen === "noPassword" ? (
          <NoPasswordInvite token={token} onExpired={markExpired} onCarry={carry} onEmail={setKnownEmail} recheck={recheck} />
        ) : (
          <CreateInvite token={token} google={status.data?.live === true && status.data.google} onExpired={markExpired} onCarry={carry} />
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
  if (outcome === "wrongEmail") return { outcome, failure: { text: t("native.invite.wrongEmail"), wrongEmail: true } };
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
 * Accept after a sign-in on this screen, then finish (`acceptAfterSignInWith`). The sign-in stored a
 * session, so a failed accept still runs the usual `afterSignIn`: the failure is carried to the
 * signed-in view (another account: its "Sign out" offer; a timeout: Join again), a dead link turns the
 * screen to the expired notice.
 */
function useAcceptAfterSignIn(token: string, onExpired: () => void, onCarry: (carried: Carried) => void) {
  const { t } = useT();
  const finish = useFinish();
  const accept = useMutation(trpc.invite.acceptByToken.mutationOptions());
  const run = useCallback(
    async (name?: string) => {
      await acceptAfterSignInWith({
        accept: () => accept.mutateAsync({ token, name }),
        signedIn: afterSignIn,
        finish,
        onExpired,
        carry: (_outcome, error) => {
          const { failure } = outcomeFailure(t, error);
          announce(failure.text, { shownInLiveRegion: true });
          feedback.error();
          onCarry({ error });
        },
      });
    },
    [accept, finish, onCarry, onExpired, t, token],
  );
  return { run };
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

/** Signed in on this phone: join with this account. `carried`: a sign-in here whose accept failed (council r1, B2). */
function SignedInInvite({ token, carried, onSignedOut }: { token: string; carried: Carried | null; onSignedOut(): void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const finish = useFinish();
  const [failure, setFailure] = useState<Failure | null>(() => (carried ? outcomeFailure(t, carried.error).failure : null));
  const [signingOut, setSigningOut] = useState(false);
  const accept = useMutation(trpc.invite.acceptByToken.mutationOptions());
  const wrongEmail = failure?.wrongEmail === true;

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
              // After the gate flipped: dropping it earlier would flash the bare signed-in view.
              onSignedOut();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

/** No account for the invite email: name, email and password, then join; Google too where it works. */
function CreateInvite({ token, google, onExpired, onCarry }: { token: string; google: boolean; onExpired(): void; onCarry(carried: Carried): void }) {
  const { t } = useT();
  const { run } = useAcceptAfterSignIn(token, onExpired, onCarry);
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

  if (existingEmail !== null) return <SignInInvite token={token} onExpired={onExpired} defaultEmail={existingEmail} onCarry={onCarry} />;

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
      {formFailure ? <Notice text={formFailure.text} /> : null}
      <Button size="lg" label={t("auth.invite.submit")} loading={busy} loadingLabel={t("native.invite.joining")} onPress={() => void submit()} />
      {/* Google makes the account only for an email with a live invite and accepts it on the way in. */}
      {google ? <AltSignIn passkey={false} finish={() => run()} error={altError} onError={setAltError} disabled={busy} /> : null}
    </View>
  );
}

/**
 * The invite email has an account with a password: sign in (any way it has), then join. A wrong email
 * or password offers "Email me a link to set a password" too, as the web form does: the status may be
 * stale (an account made since with no password), and on Android there may be no other way in (council
 * r1, B4; GPT M1).
 */
function SignInInvite({
  token,
  onExpired,
  onCarry,
  defaultEmail = "",
}: {
  token: string;
  onExpired(): void;
  onCarry(carried: Carried): void;
  defaultEmail?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const { run } = useAcceptAfterSignIn(token, onExpired, onCarry);
  const link = useSetPasswordLink(token);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: MessageKey; password?: MessageKey }>({});
  const [formFailure, setFormFailure] = useState<Failure | null>(null);
  // The last password failure, as a key: whether the set-password link is offered.
  const [failedKey, setFailedKey] = useState<MessageKey | null>(null);
  const [altError, setAltError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const passwordRef = useRef<InputRef>(null);

  function fail(text: string) {
    setFormFailure({ text });
    announce(text, { shownInLiveRegion: true });
    feedback.error();
  }

  function sendLink() {
    const clean = email.trim();
    if (!EMAIL.test(clean)) {
      const key: MessageKey = clean ? "errors.invalidEmail" : "errors.required";
      setErrors((e) => ({ ...e, email: key }));
      announce(t(key), { shownInLiveRegion: true });
      feedback.error();
      return;
    }
    void link.request(clean);
  }

  async function submit() {
    const next: typeof errors = {};
    if (!email.trim()) next.email = "errors.required";
    else if (!EMAIL.test(email.trim())) next.email = "errors.invalidEmail";
    if (!password) next.password = "errors.required";
    setErrors(next);
    setFormFailure(null);
    setFailedKey(null);
    link.reset();
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
      if (outcome.step === "error") {
        setFailedKey(outcome.messageKey);
        return fail(t(outcome.messageKey));
      }
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
      {formFailure ? <Notice text={formFailure.text} /> : null}
      <Button size="lg" label={t("auth.invite.signInSubmit")} loading={busy} loadingLabel={t("native.invite.joining")} onPress={() => void submit()} />
      {offersSetPasswordLink(failedKey) ? (
        link.state.step === "sent" ? (
          <View className="gap-2">
            <Text accessibilityLiveRegion="polite" className="font-sans text-base leading-6 text-ink">
              {t("auth.invite.setPasswordSent")}
            </Text>
            <Text className="font-sans text-base leading-6 text-ink-muted">{t("native.invite.afterSetPassword")}</Text>
          </View>
        ) : (
          <View className="gap-3">
            {link.state.step === "error" ? <Notice text={t(link.state.key)} /> : null}
            <Button
              variant="secondary"
              label={t("auth.invite.setPasswordSubmit")}
              loading={link.pending}
              loadingLabel={t("auth.invite.setPasswordSending")}
              disabled={busy}
              onPress={sendLink}
            />
          </View>
        )
      ) : null}
      <AltSignIn finish={() => run()} error={altError} onError={setAltError} disabled={busy} />
    </View>
  );
}

/**
 * The invite email has an account with no password. A passkey or Google first where they can work
 * (the account may have one), then "Email me a link to set a password", sent only when the typed email
 * is the invite's (`invite.sendSetPasswordLink`; the answer is the same either way). The link opens the
 * web invite page after the reset, where the person signs in and joins.
 *
 * Once the link went (and only then), coming back to the app reads the status again, at most once per
 * focus and never while a passkey or Google sign-in is open (council r1, B3): after the password is set
 * in the browser, the screen moves to the sign-in step with the email kept. The sent state has no field
 * to lose.
 */
function NoPasswordInvite({
  token,
  onExpired,
  onCarry,
  onEmail,
  recheck,
}: {
  token: string;
  onExpired(): void;
  onCarry(carried: Carried): void;
  onEmail(email: string): void;
  recheck(): void;
}) {
  const { t } = useT();
  // After the link went: the person sets the password in the browser, then signs in here.
  const [signIn, setSignIn] = useState(false);
  const buttons = useAltSignInButtons();
  const { run } = useAcceptAfterSignIn(token, onExpired, onCarry);
  const link = useSetPasswordLink(token);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<MessageKey | null>(null);
  const [altError, setAltError] = useState<MessageKey | null>(null);
  // A passkey or Google sign-in is open (its sheet takes the app out of focus too).
  const altBusy = useRef(false);
  const sent = link.state.step === "sent";
  const formError = link.state.step === "error" ? link.state.key : null;

  useEffect(() => {
    if (!sent || signIn) return;
    return focusManager.subscribe(createFocusRecheck({ refetch: recheck, blocked: () => altBusy.current }));
  }, [sent, signIn, recheck]);

  async function submit() {
    const clean = email.trim();
    if (!clean || !EMAIL.test(clean)) {
      const key: MessageKey = clean ? "errors.invalidEmail" : "errors.required";
      setEmailError(key);
      announce(t(key), { shownInLiveRegion: true });
      feedback.error();
      return;
    }
    setEmailError(null);
    if (await link.request(clean)) onEmail(clean);
  }

  const anyButton = buttons.passkey || buttons.google;

  if (signIn) return <SignInInvite token={token} onExpired={onExpired} defaultEmail={email.trim()} onCarry={onCarry} />;

  return (
    <View className="gap-6">
      <Info text={`${t("auth.invite.noPasswordTitle")} ${t("auth.invite.noPasswordBody")}`} />
      {anyButton ? (
        <AltSignIn
          divider={false}
          finish={() => run()}
          error={altError}
          onError={setAltError}
          onBusyChange={(busy) => {
            altBusy.current = busy;
          }}
        />
      ) : null}
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
            editable={!link.pending}
          />
          {formError ? <Notice text={t(formError)} /> : null}
          <Button
            size="lg"
            variant={anyButton ? "secondary" : undefined}
            label={t("auth.invite.setPasswordSubmit")}
            loading={link.pending}
            loadingLabel={t("auth.invite.setPasswordSending")}
            onPress={() => void submit()}
          />
        </View>
      )}
    </View>
  );
}
