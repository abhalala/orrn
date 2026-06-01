import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "../lib/auth-client";
import { queryClient, trpc } from "../utils/trpc";

export type SignInTarget = "erp" | "staff";

export default function SignInForm({
  next,
  target = "erp",
  showWaitlistLink = true,
}: {
  next?: string;
  target?: SignInTarget;
  showWaitlistLink?: boolean;
}) {
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [isVerifyingTotp, setIsVerifyingTotp] = useState(false);

  const handleSuccessRedirect = async () => {
    queryClient.removeQueries();

    let mustChangePassword = false;
    try {
      const me = await queryClient.fetchQuery(trpc.auth.me.queryOptions());
      mustChangePassword = Boolean(me?.user.mustChangePassword);
    } catch {
      // Default redirect remains valid when auth.me is temporarily unavailable.
    }

    if (mustChangePassword) {
      window.location.href = "/change-password";
      return;
    }

    let redirectUrl = target === "staff" ? "/admin" : "/dashboard";
    if (next) {
      redirectUrl = next.startsWith("http://") || next.startsWith("https://")
        ? next
        : next.startsWith("/") ? next : `/${next}`;
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
        await handleSuccessRedirect();
      }
    } catch {
      toast.error("Failed to verify code");
    } finally {
      setIsVerifyingTotp(false);
    }
  };

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        { email: value.email, password: value.password },
        {
          onSuccess: (ctx) => {
            if (ctx.data?.twoFactorRedirect) {
              setShowTwoFactor(true);
              toast.info("Two-factor authentication is required for this account.");
            } else {
              void handleSuccessRedirect();
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
        email: z.string().email("Enter a valid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  return (
    <div className="orrn-auth-card w-full max-w-[420px]">
      <Card className="w-full self-center">
      <CardHeader className="w-full">
        <CardTitle>{showTwoFactor ? "Verification" : target === "staff" ? "Staff Sign In" : "Sign In"}</CardTitle>
        <CardDescription>
          {showTwoFactor
            ? "Enter the 6-digit code from your authenticator app."
            : target === "staff"
              ? "Access the ORRN staff console."
              : "Access your ORRN workspace."}
        </CardDescription>
      </CardHeader>
      <CardContent className="w-full">
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
          className="w-full space-y-4"
        >
          {!showTwoFactor ? (
            <>
              <form.Field name="email">
                {(field) => (
                  <div className="w-full space-y-1.5">
                    <Label htmlFor={field.name}>Email Address</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      placeholder="name@company.com"
                      autoComplete="email"
                      className="w-full"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {field.state.meta.errors.map((error) => (
                      <p key={error?.message} className="text-xs text-destructive">
                        {error?.message}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>

              <form.Field name="password">
                {(field) => (
                  <div className="w-full space-y-1.5">
                    <Label htmlFor={field.name}>Password</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      placeholder="Password"
                      autoComplete="current-password"
                      className="w-full"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {field.state.meta.errors.map((error) => (
                      <p key={error?.message} className="text-xs text-destructive">
                        {error?.message}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>

              <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
                {({ canSubmit, isSubmitting }) => (
                  <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? "Signing in…" : "Sign In"}
                  </Button>
                )}
              </form.Subscribe>
            </>
          ) : (
            <>
              <div className="w-full space-y-1.5">
                <Label htmlFor="totpCode">Authenticator Code</Label>
                <Input
                  id="totpCode"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full text-center font-mono text-xl tracking-[0.25em]"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isVerifyingTotp || totpCode.length !== 6}>
                {isVerifyingTotp ? "Verifying…" : "Verify & Sign In"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
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
          <div className="border-t border-border pt-4 text-center text-sm text-muted-foreground">
            Need access?{" "}
            {target === "staff" ? (
              <a href="/waitlist" className="font-medium text-primary hover:underline">
                Request access on orrn.in
              </a>
            ) : (
              <Link to="/waitlist" className="font-medium text-primary hover:underline">
                Request a demo or join the waitlist
              </Link>
            )}
          </div>
        ) : null}
      </CardContent>
      </Card>
    </div>
  );
}
