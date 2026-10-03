import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
import { toast } from "sonner";

import { authClient } from "@/shared/lib/auth-client";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { totpErrorKey } from "../auth-errors";
import { CodeField } from "../code-field";
import { FormAlert } from "../form-alert";
import { PasswordField } from "../password-field";
import { StepHeading } from "./step-heading";

type Phase = "confirm" | "loading" | "scan" | "backup";

type Setup = { uri: string; secret: string; qr: string | null; backupCodes: string[] };

/** "JBSWY3DPEHPK3PXP" as "JBSW Y3DP EHPK 3PXP": easier to copy by eye into an app. */
function groupKey(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    // Clipboard blocked (http, permissions): the text is on screen to copy by hand.
  }
}

/**
 * Turn on two-factor (magic-link owners). Better Auth's `twoFactor.enable`
 * needs the password: the one just set in the password step, or typed here.
 * The QR is drawn in the browser (`qrcode`, loaded on demand) so the secret
 * never leaves the device; the old page sent it to a Google chart URL.
 * After the code checks out, the backup codes are shown once.
 */
export function TwoFactorStep({
  password,
  onDone,
  headingRef,
}: {
  password: string | null;
  onDone(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>(password ? "loading" : "confirm");
  const [typed, setTyped] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const backupHeading = useRef<HTMLHeadingElement>(null);

  async function enable(pw: string) {
    setPhase("loading");
    setFormError(null);
    setPasswordError(undefined);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password: pw, issuer: "orrn" });
      if (error || !data) {
        setPhase("confirm");
        if (error?.code === "INVALID_PASSWORD" || error?.status === 400 || error?.status === 401) {
          setPasswordError(t("welcome.twoFactor.wrongPassword"));
          requestAnimationFrame(() => passwordRef.current?.focus());
        } else {
          setFormError(totpErrorKey(error));
        }
        return;
      }
      let secret = "";
      try {
        secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
      } catch {
        secret = "";
      }
      let qr: string | null = null;
      try {
        const QRCode = await import("qrcode");
        qr = await QRCode.toDataURL(data.totpURI, { margin: 2, width: 400, errorCorrectionLevel: "M" });
      } catch {
        qr = null; // The manual key below still works.
      }
      setSetup({ uri: data.totpURI, secret, qr, backupCodes: data.backupCodes ?? [] });
      setPhase("scan");
    } catch (error) {
      setPhase("confirm");
      setFormError(totpErrorKey(error as Error));
    }
  }

  // With the password from the previous step, go straight to the QR. Once
  // only: a second `enable` would replace the secret behind a QR already shown.
  useEffect(() => {
    if (password && !started.current) {
      started.current = true;
      void enable(password);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  useEffect(() => {
    if (phase === "backup") backupHeading.current?.focus();
  }, [phase]);

  async function verify(value = code) {
    if (pending) return;
    if (value.length !== 6) {
      setCodeError(t("auth.totp.codeRequired"));
      return codeRef.current?.focus();
    }
    setPending(true);
    setCodeError(undefined);
    setFormError(null);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code: value });
      if (error) {
        setCodeError(t(totpErrorKey(error)));
        setCode("");
        codeRef.current?.focus();
        return;
      }
      await queryClient.invalidateQueries(trpc.auth.me.queryFilter());
      toast.success(t("welcome.twoFactor.enabled"));
      if (setup && setup.backupCodes.length > 0) setPhase("backup");
      else onDone();
    } catch (error) {
      setFormError(totpErrorKey(error as Error));
    } finally {
      setPending(false);
    }
  }

  if (phase === "backup" && setup) {
    return (
      <div className="flex flex-col gap-6">
        <StepHeading headingRef={backupHeading} title={t("welcome.twoFactor.backupTitle")} body={t("welcome.twoFactor.backupBody")} />
        <ul
          aria-label={t("welcome.twoFactor.backupTitle")}
          className="m-0 grid list-none grid-cols-2 gap-2 rounded-card border border-border bg-card p-4"
        >
          {setup.backupCodes.map((c) => (
            <li key={c} className="font-mono text-[16px] font-medium tabular-nums tracking-[0.04em] text-foreground">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            variant="secondary"
            className="w-full"
            onClick={() => void copyText(setup.backupCodes.join("\n"), t("common.copied"))}
          >
            <Copy aria-hidden="true" strokeWidth={2} />
            {t("welcome.twoFactor.copyCodes")}
          </Button>
          <Button size="lg" className="w-full" onClick={onDone}>
            {t("welcome.twoFactor.continue")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        headingRef={headingRef}
        title={t("welcome.twoFactor.title")}
        body={phase === "confirm" ? t("welcome.twoFactor.confirmBody") : t("welcome.twoFactor.body")}
      />

      {phase === "confirm" ? (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!typed) {
              setPasswordError(t("auth.validation.password"));
              return passwordRef.current?.focus();
            }
            void enable(typed);
          }}
        >
          <PasswordField
            ref={passwordRef}
            label={t("welcome.twoFactor.confirmPassword")}
            autoComplete="current-password"
            value={typed}
            onValueChange={setTyped}
            error={passwordError}
          />
          {formError ? <FormAlert>{t(formError)}</FormAlert> : null}
          <Button type="submit" size="lg" className="w-full">
            {t("welcome.twoFactor.showQr")}
          </Button>
        </form>
      ) : phase === "loading" || !setup ? (
        <div aria-busy="true" aria-label={t("welcome.twoFactor.loading")} className="flex flex-col items-center gap-5">
          <Skeleton className="size-[216px] rounded-card" />
          <Skeleton className="h-5 w-full max-w-[280px]" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-5"
          aria-busy={pending || undefined}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void verify();
          }}
        >
          <div className="flex flex-col items-center gap-4 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-start">
            {setup.qr ? (
              // Always dark-on-white with a quiet zone, whatever the theme: scanners need it.
              <img
                src={setup.qr}
                alt={t("welcome.twoFactor.qrAlt")}
                width={184}
                height={184}
                className="size-[184px] shrink-0 rounded-input [image-rendering:pixelated]"
              />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-2 self-stretch">
              <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("welcome.twoFactor.manualKey")}</p>
              <code
                data-no-truncate=""
                className="block rounded-input bg-surface-sunken px-3 py-2.5 font-mono text-[15px] font-medium tracking-[0.04em] text-foreground [overflow-wrap:anywhere]"
              >
                {groupKey(setup.secret)}
              </code>
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                onClick={() => void copyText(setup.secret, t("common.copied"))}
              >
                <Copy aria-hidden="true" strokeWidth={2} />
                {t("welcome.twoFactor.copyKey")}
              </Button>
            </div>
          </div>
          <CodeField
            ref={codeRef}
            label={t("welcome.twoFactor.code")}
            value={code}
            onValueChange={setCode}
            onComplete={(full) => void verify(full)}
            error={codeError}
          />
          {formError ? <FormAlert>{t(formError)}</FormAlert> : null}
          <Button type="submit" size="lg" loading={pending} className="w-full">
            {pending ? t("welcome.twoFactor.verifying") : t("welcome.twoFactor.submit")}
          </Button>
        </form>
      )}
    </div>
  );
}
