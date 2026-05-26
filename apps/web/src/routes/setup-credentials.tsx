import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { authClient } from "@/lib/auth-client";
import { requireSession } from "@/lib/route-guards";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/setup-credentials")({
  beforeLoad: requireSession,
  component: SetupCredentialsComponent,
});

function OrrnLogo() {
  return (
    <svg className="w-12 h-12 mx-auto filter drop-shadow-[0_0_12px_rgba(91,108,255,0.6)]" viewBox="0 0 100 100" fill="none">
      <polygon points="50,15 85,35 85,75 50,95 15,75 15,35" fill="none" stroke="#5B6CFF" strokeWidth="4" />
      <polygon points="50,25 75,40 75,70 50,85 25,70 25,40" fill="none" stroke="#22D3EE" strokeWidth="2" opacity="0.8" />
      <polygon points="50,40 60,50 50,60 40,50" fill="#5B6CFF" />
    </svg>
  );
}function SetupCredentialsComponent() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"password" | "totp">("password");
  
  // Form states
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // TOTP states
  const [totpUri, setTotpUri] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpDigits, setTotpDigits] = useState<string[]>(Array(6).fill(""));

  const setPasswordMutation = useMutation(trpc.auth.setPassword.mutationOptions());

  const handlePasswordSubmit = async (e: React.FormEvent) => {
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
      // 1. Set the password on the server
      await setPasswordMutation.mutateAsync({ password });
      toast.success("Password set successfully!");

      // 2. Request TOTP activation URI from Better Auth using the password
      const { data, error } = await authClient.twoFactor.enable({
        password,
        issuer: "ORRN-AL",
      });

      if (error) {
        toast.error(error.message || "Failed to generate QR Code");
      } else if (data) {
        setTotpUri(data.totpURI);
        try {
          const url = new URL(data.totpURI);
          const secret = url.searchParams.get("secret") || "";
          setSecretKey(secret);
        } catch {
          setSecretKey("");
        }
        setStep("totp");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to set password or initiate 2FA");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTotpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCode = totpDigits.join("");
    if (finalCode.length !== 6) {
      toast.error("Enter a valid 6-digit verification code");
      return;
    }

    setIsSubmitting(true);
    try {
      // Use verifyTotp to verify the client code and complete 2FA enablement
      const { error } = await authClient.twoFactor.verifyTotp({
        code: finalCode,
      });

      if (error) {
        toast.error(error.message || "Verification failed. Check the code.");
      } else {
        toast.success("Two-Factor Authentication activated successfully!");
        navigate({ to: "/onboarding" });
      }
    } catch (err: any) {
      toast.error("Failed to verify code");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Simple password strength calculation
  const getPasswordStrength = () => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  };

  const strength = getPasswordStrength();

  const handleDigitChange = (index: number, val: string) => {
    const newVal = val.replace(/\D/g, "").slice(-1);
    const newDigits = [...totpDigits];
    newDigits[index] = newVal;
    setTotpDigits(newDigits);

    // Auto-focus next field
    if (newVal && index < 5) {
      const nextInputEl = document.getElementById(`totp-digit-${index + 1}`);
      nextInputEl?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!totpDigits[index] && index > 0) {
        const newDigits = [...totpDigits];
        newDigits[index - 1] = "";
        setTotpDigits(newDigits);
        const prevInput = document.getElementById(`totp-digit-${index - 1}`);
        prevInput?.focus();
      } else {
        const newDigits = [...totpDigits];
        newDigits[index] = "";
        setTotpDigits(newDigits);
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pastedData.length === 6) {
      const digitsArray = pastedData.split("");
      setTotpDigits(digitsArray);
      // Focus last input
      document.getElementById(`totp-digit-5`)?.focus();
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-4 bg-[#0b0f1a] overflow-hidden w-full">
      {/* Background mesh glow */}
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-gradient-to-r from-[#5B6CFF]/15 to-[#22D3EE]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />
      <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-gradient-to-l from-[#22D3EE]/10 to-[#5B6CFF]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-[0.15] pointer-events-none -z-10" />

      <div className="w-full max-w-lg space-y-8 rounded-2xl border border-[#5B6CFF]/20 bg-[#121826]/70 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300 relative overflow-hidden">
        {/* Top border highlight */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#5B6CFF]/30 to-transparent" />
        
        <div className="space-y-3 text-center">
          <OrrnLogo />
          <h1 className="text-3xl font-extrabold tracking-tight text-[#f5f7ff] font-mono">
            {step === "password" ? "Secure Your Account" : "Activate Two-Factor"}
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            {step === "password" 
              ? "Establish your administrative password to access your plant console."
              : "Scan the QR code to set up Google Authenticator 2FA."}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center space-x-4">
          <span className={`h-2 w-16 rounded-full transition-all duration-300 ${step === "password" ? "bg-[#5B6CFF] shadow-[0_0_8px_#5B6CFF]" : "bg-[#5B6CFF]/30"}`} />
          <span className={`h-2 w-16 rounded-full transition-all duration-300 ${step === "totp" ? "bg-[#5B6CFF] shadow-[0_0_8px_#5B6CFF]" : "bg-muted/20"}`} />
        </div>

        {step === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">New Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 transition-all rounded-lg"
              />
              
              {/* Strength Meter */}
              {password && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-[10px] font-mono font-bold text-muted-foreground uppercase">
                    <span>Password Strength</span>
                    <span className={strength <= 2 ? "text-red-400" : strength <= 4 ? "text-yellow-400" : "text-emerald-400"}>
                      {strength <= 2 ? "Weak" : strength <= 4 ? "Good" : "Strong"}
                    </span>
                  </div>
                  <div className="flex space-x-1 h-1.5">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className={`h-full flex-1 rounded-full transition-colors duration-300 ${
                          level <= strength
                            ? strength <= 2
                              ? "bg-red-500"
                              : strength <= 4
                                ? "bg-yellow-500"
                                : "bg-emerald-500"
                            : "bg-muted/30"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 transition-all rounded-lg"
              />
            </div>

            <Button
              type="submit"
              className="w-full mt-2 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 border border-white/5 transition-all hover:scale-[1.01]"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving Password..." : "Save Password & Continue"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleTotpVerify} className="space-y-6">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative rounded-xl border border-border/20 bg-[#0B0F1A] p-4 shadow-2xl">
                {totpUri ? (
                  <img
                    src={`https://chart.googleapis.com/chart?chs=180&cht=qr&chl=${encodeURIComponent(totpUri)}`}
                    alt="2FA QR Code"
                    className="h-[180px] w-[180px] select-none rounded-lg"
                  />
                ) : (
                  <div className="flex h-[180px] w-[180px] items-center justify-center text-xs font-mono text-muted-foreground animate-pulse">
                    Generating QR...
                  </div>
                )}
                {/* Neon Cyan Scanning Indicator Line */}
                <div className="absolute left-0 top-0 h-0.5 w-full bg-[#22D3EE] shadow-[0_0_8px_#22D3EE] animate-[bounce_3s_infinite]" />
              </div>

              {secretKey && (
                <div className="w-full text-center space-y-2">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block">Secret Key (Manual Entry)</span>
                  <div className="flex items-center justify-center space-x-2">
                    <code className="text-[11px] bg-[#0b0f1a]/80 px-3 py-1.5 rounded-lg border border-border/20 text-cyan-400 font-mono select-all">
                      {secretKey}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(secretKey);
                        toast.success("Secret copied!");
                      }}
                      className="text-xs text-[#22D3EE] hover:text-[#22D3EE]/80 font-bold font-mono"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <Label className="text-center block text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">
                Enter 6-Digit Authenticator Code
              </Label>
              
              {/* 6 Individual Digit Inputs */}
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
                    className="w-11 h-12 text-center text-xl font-bold font-mono text-[#f5f7ff] bg-[#0b0f1a]/60 border border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] rounded-lg outline-none transition-all"
                  />
                ))}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 border border-white/5 transition-all hover:scale-[1.01]"
              disabled={isSubmitting || !totpUri || totpDigits.join("").length !== 6}
            >
              {isSubmitting ? "Verifying..." : "Verify & Complete Setup"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
