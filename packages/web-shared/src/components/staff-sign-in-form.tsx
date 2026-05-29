import { useState } from "react";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "../lib/auth-client";
import { appUrls } from "../lib/urls";
import { queryClient } from "../utils/trpc";
import { trpc } from "../utils/trpc";

/**
 * orrn.app login — email + password only (no magic link, no public sign-up).
 * Rejects tenant-only accounts after credentials verify.
 */
export default function StaffSignInForm() {
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [isVerifyingTotp, setIsVerifyingTotp] = useState(false);

  const finishStaffLogin = async () => {
    queryClient.removeQueries();
    try {
      const me = await queryClient.fetchQuery(trpc.auth.me.queryOptions());
      if (!me?.isPlatformAdmin || !me.platformRole) {
        await authClient.signOut();
        queryClient.clear();
        toast.error("This account does not have staff console access.");
        return;
      }
      window.location.href = `${appUrls.staff}/admin`;
      toast.success("Signed in");
    } catch {
      toast.error("Could not verify staff access");
    }
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
        toast.error(error.message || "Verification failed");
      } else {
        await finishStaffLogin();
      }
    } finally {
      setIsVerifyingTotp(false);
    }
  };

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email.trim().toLowerCase(),
          password: value.password,
        },
        {
          onSuccess: async (ctx) => {
            if (ctx.data?.twoFactorRedirect) {
              setShowTwoFactor(true);
              toast.info("Enter your authenticator code to continue.");
              return;
            }
            await finishStaffLogin();
          },
          onError: (error) => {
            toast.error(error.error.message || "Sign in failed");
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

  return (
    <div className="w-full max-w-md p-8 rounded-2xl border border-[#5B6CFF]/15 bg-[#121826]/70 backdrop-blur-xl shadow-2xl space-y-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#5B6CFF]/30 to-transparent" />

      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#f5f7ff] font-mono">
          {showTwoFactor ? "Verification" : "Staff sign in"}
        </h1>
        <p className="text-xs text-muted-foreground font-mono">
          {showTwoFactor
            ? "Authenticator code required."
            : "orrn.app — internal staff only. Use the credentials issued by your administrator."}
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
                  <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">
                    Email
                  </Label>
                  <Input
                    id={field.name}
                    type="email"
                    placeholder="you@orrn.in"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="bg-[#0b0f1a]/60 border-border/40 h-10"
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">
                    Password
                  </Label>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder="••••••••"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="bg-[#0b0f1a]/60 border-border/40 h-10"
                  />
                </div>
              )}
            </form.Field>

            <form.Subscribe
              selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" className="w-full mt-2" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </Button>
              )}
            </form.Subscribe>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="staff-totp" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">
                2FA code
              </Label>
              <Input
                id="staff-totp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-2xl tracking-[0.4em] h-12"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isVerifyingTotp || totpCode.length !== 6}>
              {isVerifyingTotp ? "Verifying…" : "Verify"}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
