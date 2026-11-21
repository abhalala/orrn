import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { FormAlert } from "@/features/auth/form-alert";
import { googleLinkErrorKey } from "@/features/auth/google-link";
import { GoogleLinkButton } from "@/features/auth/google-link-button";
import { addPasskeyHere } from "@/features/auth/passkey-actions";
import { passkeySupport } from "@/features/auth/passkey-support";
import { resetRedirectUrl } from "@/features/auth/password-reset";
import { PasswordField } from "@/features/auth/password-field";
import { MethodError } from "@/features/auth/sign-in-again";
import { TwoFactorStep } from "@/features/auth/welcome/two-factor-step";
import { authClient } from "@/shared/lib/auth-client";
import { useFmt } from "@/shared/lib/fmt";
import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { canRemove, methodCounts, REMOVE_REASON, signInChangeErrorKey, type Methods, type RemoveVerdict } from "./sign-in-model";
import { Note, TabState } from "./ui";

/** Where Google and a fresh sign-in come back to. */
export const SIGN_IN_TAB_PATH = "/settings?tab=sign-in";

type Listed = NonNullable<ReturnType<typeof useSignInMethods>["data"]>;
type Passkey = Listed["passkeys"][number];

function useSignInMethods() {
  return useQuery({ ...trpc.auth.signInMethods.queryOptions(), meta: INLINE_ERROR_META });
}

/** After any change: the list here, and `auth.me` (the guards and the welcome steps read it). */
async function refresh() {
  await Promise.all([
    queryClient.invalidateQueries(trpc.auth.signInMethods.queryFilter()),
    queryClient.invalidateQueries(trpc.auth.me.queryFilter()),
  ]);
}

const reason = (verdict: RemoveVerdict): MessageKey | null => (verdict.ok ? null : REMOVE_REASON[verdict.code]);

/**
 * Settings > Sign-in (plan 2026-11-18, Task 5): the signed-in person's own ways in, the same in every plant.
 * Passkeys (add, rename, remove), Google (link, unlink), password (set or change by an emailed link, the
 * forgot-password flow) and the authenticator app (on with the welcome flow, off with the password). A
 * removal the server would refuse (`canRemove`) is disabled with the reason beside it; the server still
 * judges, and its refusal reads the same. A Google link that failed comes back with `?error=`.
 */
export function SignInTab() {
  const { t } = useT();
  const { error: linkCode } = useSearch({ from: "/_tenant/settings" });
  const [googleError] = useState(() => googleLinkErrorKey(linkCode));
  const query = useSignInMethods();
  const listed = query.data;
  return (
    <section aria-labelledby="sign-in-heading" className="flex min-w-0 flex-col gap-4" data-testid="settings-sign-in">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="sign-in-heading" className="m-0 text-[17px] font-semibold">
          {t("settings.signIn.title")}
        </h2>
        <Note>{t("settings.signIn.body")}</Note>
      </div>
      <TabState query={query}>
        {listed ? (
          <>
            <PasskeysCard listed={listed} />
            <GoogleCard listed={listed} initialError={googleError} />
            <PasswordCard listed={listed} />
            <AuthenticatorCard listed={listed} />
          </>
        ) : null}
      </TabState>
    </section>
  );
}

/** One method: its name, what it is, its state, then what can be done with it. */
function MethodCard({
  title,
  hint,
  status,
  testId,
  children,
}: {
  title: string;
  hint: string;
  status?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} data-testid={testId} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <h3 id={titleId} className="m-0 text-[15px] leading-6 font-semibold break-words">
            {title}
          </h3>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground break-words">{hint}</p>
        </div>
        {status}
      </div>
      {children}
    </section>
  );
}

function PasskeysCard({ listed }: { listed: Listed }) {
  const { t } = useT();
  const fmt = useFmt();
  const [available] = useState(() => passkeySupport().available);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const reasonId = useId();
  const blocked = reason(canRemove(methodCounts(listed), "passkey", listed.requiredByPlant));
  const label = (p: Passkey) => p.name?.trim() || t("settings.signIn.passkeyUnnamed");

  async function add() {
    if (adding) return;
    setError(null);
    setAdding(true);
    const failure = await addPasskeyHere();
    setAdding(false);
    if (failure) setError(failure);
    else toast.success(t("settings.signIn.passkeyAdded"));
  }

  return (
    <MethodCard testId="sign-in-passkeys" title={t("settings.signIn.passkeys")} hint={t("settings.signIn.passkeysHint")}>
      {listed.passkeys.length === 0 ? (
        <Note>{t("settings.signIn.noPasskeys")}</Note>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {listed.passkeys.map((p) => (
            <li key={p.id} data-testid="passkey-row" className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-40">
                <p className="m-0 text-[15px] leading-6 font-semibold break-words">{label(p)}</p>
                <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                  {t("settings.signIn.added", { date: fmt.date(dateValue(p.createdAt), { year: true }) })}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setRenaming(p)} aria-label={`${t("settings.signIn.rename")}: ${label(p)}`}>
                  {t("settings.signIn.rename")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={blocked !== null}
                  aria-describedby={blocked ? reasonId : undefined}
                  onClick={() => setRemoving(p)}
                  aria-label={`${t("common.remove")}: ${label(p)}`}
                >
                  {t("common.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {blocked && listed.passkeys.length > 0 ? (
        <p id={reasonId} data-testid="passkey-remove-reason" className="m-0 text-[13px] leading-5 text-muted-foreground break-words">
          {t(blocked)}
        </p>
      ) : null}
      {available ? (
        <Button className="self-start" loading={adding} onClick={() => void add()} data-testid="add-passkey">
          {adding ? null : <KeyRound aria-hidden="true" />}
          {t("settings.signIn.addPasskey")}
        </Button>
      ) : (
        <Note testId="no-passkey-support">{t("settings.signIn.noPasskeySupport")}</Note>
      )}
      {error ? <MethodError error={error} next={SIGN_IN_TAB_PATH} /> : null}
      {renaming ? <RenameDialog passkey={renaming} name={label(renaming)} onClose={() => setRenaming(null)} /> : null}
      {removing ? <RemoveDialog passkey={removing} name={label(removing)} onClose={() => setRemoving(null)} /> : null}
    </MethodCard>
  );
}

/** tRPC sends dates as ISO text (no transformer); the type may still say Date. */
function dateValue(at: Date | string): string {
  return typeof at === "string" ? at : at.toISOString();
}

function RenameDialog({ passkey, name, onClose }: { passkey: Passkey; name: string; onClose(): void }) {
  const { t } = useT();
  const [value, setValue] = useState(passkey.name ?? "");
  const [fieldError, setFieldError] = useState<MessageKey | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const formId = useId();

  async function save(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return setFieldError("settings.signIn.nameRequired");
    setFieldError(null);
    setError(null);
    setPending(true);
    try {
      const { error: failure } = await authClient.passkey.updatePasskey({ id: passkey.id, name: trimmed });
      if (failure) return setError(signInChangeErrorKey(failure));
      await refresh();
      toast.success(t("settings.signIn.renamed"));
      onClose();
    } catch (thrown) {
      setError(signInChangeErrorKey(thrown as Error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("settings.signIn.renameTitle")}
      description={name}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
        <Field label={t("settings.signIn.nameLabel")} hint={t("settings.signIn.nameHint")} error={fieldError ? t(fieldError) : undefined}>
          <TextInput value={value} maxLength={64} autoComplete="off" onChange={(e) => setValue(e.target.value)} />
        </Field>
        {error ? <FormAlert>{t(error)}</FormAlert> : null}
      </form>
    </Dialog>
  );
}

function RemoveDialog({ passkey, name, onClose }: { passkey: Passkey; name: string; onClose(): void }) {
  const { t } = useT();
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    setError(null);
    setPending(true);
    try {
      const { error: failure } = await authClient.passkey.deletePasskey({ id: passkey.id });
      if (failure) return setError(signInChangeErrorKey(failure));
      await refresh();
      toast.success(t("settings.signIn.removed"));
      onClose();
    } catch (thrown) {
      setError(signInChangeErrorKey(thrown as Error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("settings.signIn.removeTitle")}
      description={t("settings.signIn.removeBody", { name })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={pending} onClick={() => void remove()} data-testid="confirm-remove-passkey">
            {t("common.remove")}
          </Button>
        </>
      }
    >
      {error ? <FormAlert>{t(error)}</FormAlert> : null}
    </Dialog>
  );
}

function GoogleCard({ listed, initialError }: { listed: Listed; initialError: MessageKey | null }) {
  const { t } = useT();
  const { data: me } = useMe();
  // A failed read only hides "Link Google"; a linked account still shows (and can be unlinked).
  const methods = useQuery({ ...trpc.auth.methods.queryOptions(), staleTime: Infinity, retry: false, meta: INLINE_ERROR_META });
  const [error, setError] = useState<MessageKey | null>(initialError);
  const [unlinking, setUnlinking] = useState(false);
  const reasonId = useId();
  if (!listed.google && methods.data?.google !== true && !error) return null;
  const blocked = reason(canRemove(methodCounts(listed), "google", listed.requiredByPlant));

  return (
    <MethodCard
      testId="sign-in-google"
      title={t("settings.signIn.google")}
      hint={t("settings.signIn.googleHint", { email: me?.user.email ?? "" })}
      status={<Chip tone={listed.google ? "green" : "neutral"}>{listed.google ? t("settings.signIn.linked") : t("settings.signIn.notLinked")}</Chip>}
    >
      {listed.google ? (
        <>
          <Button
            variant="secondary"
            className="self-start"
            disabled={blocked !== null}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={() => setUnlinking(true)}
          >
            {t("settings.signIn.unlink")}
          </Button>
          {blocked ? (
            <p id={reasonId} className="m-0 text-[13px] leading-5 text-muted-foreground break-words">
              {t(blocked)}
            </p>
          ) : null}
        </>
      ) : methods.data?.google === true ? (
        <GoogleLinkButton
          path={SIGN_IN_TAB_PATH}
          className="self-start"
          emailVerified={listed.emailVerified}
          methods={methodCounts(listed)}
          onError={setError}
        />
      ) : null}
      {error ? <MethodError error={error} next={SIGN_IN_TAB_PATH} /> : null}
      {unlinking ? <UnlinkDialog onClose={() => setUnlinking(false)} onError={setError} /> : null}
    </MethodCard>
  );
}

function UnlinkDialog({ onClose, onError }: { onClose(): void; onError(key: MessageKey): void }) {
  const { t } = useT();
  const [pending, setPending] = useState(false);

  async function unlink() {
    setPending(true);
    try {
      const { error } = await authClient.unlinkAccount({ providerId: "google" });
      if (error) {
        onError(signInChangeErrorKey(error));
        return onClose();
      }
      await refresh();
      toast.success(t("settings.signIn.unlinked"));
      onClose();
    } catch (thrown) {
      onError(signInChangeErrorKey(thrown as Error));
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("settings.signIn.unlinkTitle")}
      description={t("settings.signIn.unlinkBody")}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={pending} onClick={() => void unlink()}>
            {t("settings.signIn.unlink")}
          </Button>
        </>
      }
    />
  );
}

/**
 * Set or change the password by the emailed reset link (the forgot-password flow; a reset makes the
 * password when the account has none). There is no in-app change form: the link proves the mailbox, and
 * finishing it signs out every session (`revokeSessionsOnPasswordReset`), which the dialog says first.
 */
function PasswordCard({ listed }: { listed: Listed }) {
  const { t } = useT();
  const { data: me } = useMe();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const email = me?.user.email ?? "";
  const action = listed.password ? t("settings.signIn.changePassword") : t("settings.signIn.setPassword");

  async function send() {
    setPending(true);
    setFailed(false);
    try {
      const { error } = await authClient.requestPasswordReset({ email, redirectTo: resetRedirectUrl(window.location.origin) });
      if (error) setFailed(true);
      else setSentTo(email);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
      setAsking(false);
    }
  }

  return (
    <MethodCard
      testId="sign-in-password"
      title={t("settings.signIn.password")}
      hint={t("settings.signIn.passwordHint")}
      status={
        <Chip tone={listed.password ? "green" : "neutral"}>
          {listed.password ? t("settings.signIn.passwordSet") : t("settings.signIn.passwordNotSet")}
        </Chip>
      }
    >
      <Button variant="secondary" className="self-start" onClick={() => setAsking(true)}>
        {action}
      </Button>
      {sentTo ? (
        <Note role="status" testId="password-link-sent">
          {t("settings.signIn.linkSent", { email: sentTo })}
        </Note>
      ) : null}
      {failed ? <FormAlert>{t("settings.signIn.linkFailed")}</FormAlert> : null}
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={action}
        description={t("settings.signIn.passwordLinkBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </Button>
            <Button loading={pending} onClick={() => void send()}>
              {t("settings.signIn.sendLink")}
            </Button>
          </>
        }
      />
    </MethodCard>
  );
}

function AuthenticatorCard({ listed }: { listed: Listed }) {
  const { t } = useT();
  const { data: me } = useMe();
  const [turningOn, setTurningOn] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const reasonId = useId();
  const counts: Methods = methodCounts(listed);
  const blocked = reason(canRemove(counts, "authenticator", listed.requiredByPlant));
  const on = listed.authenticator;

  return (
    <MethodCard
      testId="sign-in-authenticator"
      title={t("settings.signIn.authenticator")}
      hint={t("settings.signIn.authenticatorHint")}
      status={<Chip tone={on ? "green" : "neutral"}>{on ? t("settings.modules.on") : t("settings.modules.off")}</Chip>}
    >
      {/* The setup stays mounted until its own end: once the code checks out the server says "on", and a
          refetch (window focus) must not take away the backup codes shown once. */}
      {turningOn && me ? (
        <div className="border-t border-border pt-4">
          <TwoFactorStep
            headingLevel={3}
            userId={me.user.id}
            password={null}
            onDone={() => {
              setTurningOn(false);
              void refresh();
              toast.success(t("settings.signIn.turnedOn"));
            }}
            footer={
              <Button variant="ghost" className="self-center text-muted-foreground" onClick={() => setTurningOn(false)}>
                {t("common.cancel")}
              </Button>
            }
          />
        </div>
      ) : on ? (
        <>
          <Button
            variant="secondary"
            className="self-start"
            disabled={blocked !== null}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={() => setTurningOff(true)}
          >
            {t("settings.signIn.turnOff")}
          </Button>
          {blocked ? (
            <p id={reasonId} className="m-0 text-[13px] leading-5 text-muted-foreground break-words">
              {t(blocked)}
            </p>
          ) : null}
        </>
      ) : listed.password ? (
        <Button variant="secondary" className="self-start" onClick={() => setTurningOn(true)}>
          {t("settings.signIn.turnOn")}
        </Button>
      ) : (
        <Note testId="authenticator-needs-password">{t("settings.signIn.needsPassword")}</Note>
      )}
      {turningOff ? <TurnOffDialog onClose={() => setTurningOff(false)} /> : null}
    </MethodCard>
  );
}

function TurnOffDialog({ onClose }: { onClose(): void }) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<MessageKey | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const formId = useId();

  async function turnOff(e: FormEvent) {
    e.preventDefault();
    if (!password) return setFieldError("auth.validation.password");
    setFieldError(null);
    setError(null);
    setPending(true);
    try {
      const { error: failure } = await authClient.twoFactor.disable({ password });
      if (failure) {
        const key = signInChangeErrorKey(failure);
        if (key === "welcome.twoFactor.wrongPassword") setFieldError(key);
        else setError(key);
        return;
      }
      await refresh();
      toast.success(t("settings.signIn.turnedOff"));
      onClose();
    } catch (thrown) {
      setError(signInChangeErrorKey(thrown as Error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("settings.signIn.authenticator")}
      description={t("settings.signIn.turnOffBody")}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={pending}>
            {t("settings.signIn.turnOff")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void turnOff(e)} className="flex flex-col gap-4">
        <PasswordField
          label={t("welcome.twoFactor.confirmPassword")}
          autoComplete="current-password"
          value={password}
          onValueChange={setPassword}
          error={fieldError ? t(fieldError) : undefined}
        />
        {error ? <MethodError error={error} next={SIGN_IN_TAB_PATH} /> : null}
      </form>
    </Dialog>
  );
}
