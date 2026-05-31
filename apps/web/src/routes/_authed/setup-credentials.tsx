import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clipboard, Eye, EyeOff, ShieldCheck } from "lucide-react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/shared/lib/auth-client";
import { requireSession } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_authed/setup-credentials")({
  beforeLoad: requireSession,
  component: SetupCredentialsComponent,
});

function SetupCredentialsComponent() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [totpUri, setTotpUri] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [totpDigits, setTotpDigits] = useState<string[]>(Array(6).fill(""));

  const setPasswordMutation = useMutation(trpc.auth.setPassword.mutationOptions());
  const strength = getPasswordStrength(password);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters long");
      return;
    }

    setIsSubmitting(true);
    try {
      await setPasswordMutation.mutateAsync({ password });
      const { data, error } = await authClient.twoFactor.enable({
        password,
        issuer: "ORRN",
      });

      if (error) {
        toast.error(error.message || "Failed to generate 2FA setup");
      } else if (data) {
        setTotpUri(data.totpURI);
        try {
          const url = new URL(data.totpURI);
          setSecretKey(url.searchParams.get("secret") || "");
        } catch {
          setSecretKey("");
        }
        setStep("totp");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to set password or start 2FA setup");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTotpVerify = async (e: FormEvent) => {
    e.preventDefault();
    const finalCode = totpDigits.join("");
    if (finalCode.length !== 6) {
      toast.error("Enter a valid 6-digit verification code");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code: finalCode });
      if (error) {
        toast.error(error.message || "Verification failed. Check the code.");
      } else {
        toast.success("Two-factor authentication activated.");
        navigate({ to: "/onboarding" });
      }
    } catch {
      toast.error("Failed to verify code");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDigitChange = (index: number, val: string) => {
    const newVal = val.replace(/\D/g, "").slice(-1);
    const newDigits = [...totpDigits];
    newDigits[index] = newVal;
    setTotpDigits(newDigits);
    if (newVal && index < 5) document.getElementById(`totp-digit-${index + 1}`)?.focus();
  };

  const handleDigitKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !totpDigits[index] && index > 0) {
      const newDigits = [...totpDigits];
      newDigits[index - 1] = "";
      setTotpDigits(newDigits);
      document.getElementById(`totp-digit-${index - 1}`)?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) document.getElementById(`totp-digit-${index - 1}`)?.focus();
    if (e.key === "ArrowRight" && index < 5) document.getElementById(`totp-digit-${index + 1}`)?.focus();
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pastedData.length === 6) {
      setTotpDigits(pastedData.split(""));
      document.getElementById("totp-digit-5")?.focus();
    }
  };

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{step === "password" ? "Secure Your Account" : "Activate Two-Factor Authentication"}</CardTitle>
        <CardDescription>
          {step === "password"
            ? "Set your permanent password before entering the workspace."
            : "Scan the code, then enter the authenticator app code."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex gap-2">
          <span className={`h-1.5 flex-1 rounded-md ${step === "password" ? "bg-primary" : "bg-muted"}`} />
          <span className={`h-1.5 flex-1 rounded-md ${step === "totp" ? "bg-primary" : "bg-muted"}`} />
        </div>

        {step === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-5">
            <PasswordInput
              id="password"
              label="New Password"
              value={password}
              show={showPassword}
              onShowChange={() => setShowPassword((value) => !value)}
              onChange={setPassword}
            />
            {password ? <StrengthMeter strength={strength} /> : null}
            <PasswordInput
              id="confirmPassword"
              label="Confirm Password"
              value={confirmPassword}
              show={showConfirm}
              onShowChange={() => setShowConfirm((value) => !value)}
              onChange={setConfirmPassword}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || password.length < 8 || password !== confirmPassword}
            >
              {isSubmitting ? "Saving Password…" : "Save Password & Continue"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleTotpVerify} className="space-y-6">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-md border border-border bg-background p-3">
                {totpUri ? (
                  <img
                    src={`https://chart.googleapis.com/chart?chs=180&cht=qr&chl=${encodeURIComponent(totpUri)}`}
                    alt="2FA QR Code"
                    className="h-[180px] w-[180px] rounded-md"
                  />
                ) : (
                  <div className="flex h-[180px] w-[180px] items-center justify-center text-sm text-muted-foreground">
                    Generating QR…
                  </div>
                )}
              </div>
              {secretKey ? (
                <div className="w-full rounded-md border border-border bg-background p-3 text-center">
                  <p className="text-xs font-medium text-muted-foreground">Manual entry key</p>
                  <div className="mt-2 flex items-center justify-center gap-2">
                    <code className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">{secretKey}</code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(secretKey);
                        toast.success("Secret copied.");
                      }}
                    >
                      <Clipboard size={14} aria-hidden="true" /> Copy
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <Label className="block text-center">Authenticator Code</Label>
              <div className="flex justify-center gap-2" onPaste={handlePaste}>
                {totpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    id={`totp-digit-${idx}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                    className="h-12 w-10 rounded-md border border-input bg-background text-center font-mono text-xl font-semibold text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                    spellCheck={false}
                    autoComplete="one-time-code"
                  />
                ))}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || !totpUri || totpDigits.join("").length !== 6}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              {isSubmitting ? "Verifying Setup…" : "Verify & Complete Setup"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordInput({
  id,
  label,
  value,
  show,
  onShowChange,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  show: boolean;
  onShowChange: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          placeholder="Password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className="w-full pr-10"
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={onShowChange}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function StrengthMeter({ strength }: { strength: number }) {
  const label = strength <= 2 ? "Weak" : strength <= 4 ? "Good" : "Strong";
  const tone = strength <= 2 ? "bg-red-500" : strength <= 4 ? "bg-yellow-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-medium text-muted-foreground">
        <span>Password strength</span>
        <span>{label}</span>
      </div>
      <div className="flex h-1.5 gap-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <div key={level} className={`h-full flex-1 rounded-md ${level <= strength ? tone : "bg-muted"}`} />
        ))}
      </div>
    </div>
  );
}

function getPasswordStrength(password: string) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}
