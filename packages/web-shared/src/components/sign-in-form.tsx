import { useState } from "react";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "../lib/auth-client";
import { appUrls } from "../lib/urls";
import { queryClient } from "../utils/trpc";

export type SignInTarget = "erp" | "staff";

export default function SignInForm({
  next,
  target = "erp",
  showWaitlistLink = true,
}: {
  next?: string;
  /** Where to send the user after a successful sign-in. */
  target?: SignInTarget;
  showWaitlistLink?: boolean;
}) {
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [isVerifyingTotp, setIsVerifyingTotp] = useState(false);

  const handleSuccessRedirect = () => {
    queryClient.removeQueries();

    let redirectUrl =
      target === "staff" ? `${appUrls.staff}/admin` : `${appUrls.erp}/dashboard`;
    if (next) {
      if (next.startsWith("http://") || next.startsWith("https://")) {
        redirectUrl = next;
      } else if (target === "staff") {
        redirectUrl = `${appUrls.staff}${next.startsWith("/") ? next : `/${next}`}`;
      } else {
        redirectUrl = `${appUrls.erp}${next.startsWith("/") ? next : `/${next}`}`;
      }
    }

    window.location.href = redirectUrl;
    toast.success("Sign in successful");
  };

  const handleTotpSubmit = async () => {
    if (totpCode.length !== 6) {
      toast.error("Enter a valid 6-digit verification code");
      return;
    }
    setIsVerifyingTotp(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: totpCode,
        trustDevice: true,
      });

      if (error) {
        toast.error(error.message || "Verification failed. Check the code.");
      } else {
        handleSuccessRedirect();
      }
    } catch {
      toast.error("Failed to verify code");
    } finally {
      setIsVerifyingTotp(false);
    }
  };

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
        },
        {
          onSuccess: (ctx) => {
            if (ctx.data?.twoFactorRedirect) {
              setShowTwoFactor(true);
              toast.info("Two-Factor Authentication is required for this account.");
            } else {
              handleSuccessRedirect();
            }
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  const waitlistHref =
    target === "staff" ? `${appUrls.marketing}/waitlist` : "/waitlist";

  return (
    <div className="w-full max-w-md p-8 rounded-2xl border border-[#5B6CFF]/15 bg-[#121826]/70 backdrop-blur-xl shadow-2xl space-y-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#5B6CFF]/30 to-transparent" />

      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#f5f7ff] font-mono">
          {showTwoFactor ? "Verification" : "Welcome Back"}
        </h1>
        <p className="text-xs text-muted-foreground font-mono">
          {showTwoFactor
            ? "Enter the 6-digit code from your authenticator app."
            : target === "staff"
              ? "Sign in to the ORRN staff console."
              : "Sign in to your ORRN-AL workspace."}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (showTwoFactor) {
            void handleTotpSubmit();
          } else {
            form.handleSubmit();
          }
        }}
        className="space-y-4"
      >
        {!showTwoFactor ? (
          <>
            <form.Field name="email">
              {(field) => (
                <div className="space-y-1.5">
                  <Label
                    htmlFor={field.name}
                    className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono"
                  >
                    Email Address
                  </Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    placeholder="name@company.com"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 transition-all rounded-lg"
                  />
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className="text-[11px] font-semibold text-red-400 font-mono">
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <div className="space-y-1.5">
                  <Label
                    htmlFor={field.name}
                    className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono"
                  >
                    Password
                  </Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    placeholder="••••••••"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 transition-all rounded-lg"
                  />
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className="text-[11px] font-semibold text-red-400 font-mono">
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>

            <form.Subscribe
              selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button
                  type="submit"
                  className="w-full mt-4 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 transition-all border border-white/5 hover:scale-[1.01]"
                  disabled={!canSubmit || isSubmitting}
                >
                  {isSubmitting ? "Signing in..." : "Sign In"}
                </Button>
              )}
            </form.Subscribe>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label
                htmlFor="totpCode"
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono"
              >
                Authenticator 2FA Code
              </Label>
              <Input
                id="totpCode"
                type="text"
                placeholder="123456"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-2xl tracking-[0.4em] bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] text-[#f5f7ff] h-12 rounded-lg"
                required
              />
            </div>

            <Button
              type="submit"
              className="w-full mt-4 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 transition-all border border-white/5"
              disabled={isVerifyingTotp || totpCode.length !== 6}
            >
              {isVerifyingTotp ? "Verifying..." : "Verify & Sign In"}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full border-border/40 hover:bg-muted/30 text-xs font-semibold text-muted-foreground hover:text-[#f5f7ff]"
              onClick={() => {
                setShowTwoFactor(false);
                setTotpCode("");
              }}
            >
              Back to Password
            </Button>
          </>
        )}
      </form>

      {!showTwoFactor && showWaitlistLink ? (
        <div className="mt-6 text-center text-xs text-muted-foreground border-t border-border/10 pt-4 font-mono">
          Need access?{" "}
          {target === "staff" ? (
            <a href={waitlistHref} className="text-[#5B6CFF] hover:underline font-bold">
              Request access on orrn.in
            </a>
          ) : (
            <Link to="/waitlist" className="text-[#5B6CFF] hover:underline font-bold">
              Request a Demo or Join Waitlist
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
