import { useState } from "react";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { getDomainConfig } from "@/lib/domain";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/trpc";

export default function SignInForm({
  next,
}: {
  next?: string;
}) {
  const navigate = useNavigate({
    from: "/",
  });

  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [isVerifyingTotp, setIsVerifyingTotp] = useState(false);

  const handleSuccessRedirect = () => {
    queryClient.removeQueries();
    const { erpUrl, isOrrnAppDomain } = getDomainConfig();
    
    let redirectUrl = isOrrnAppDomain ? "/admin" : `${erpUrl}/dashboard`;
    if (next) {
      if (next.startsWith("http://") || next.startsWith("https://")) {
        redirectUrl = next;
      } else {
        const baseUrl = isOrrnAppDomain ? "" : erpUrl;
        redirectUrl = `${baseUrl}${next.startsWith("/") ? next : `/${next}`}`;
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
    } catch (err: any) {
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

  return (
    <div className="w-full max-w-md p-8 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md shadow-2xl space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">
          {showTwoFactor ? "Verification" : "Welcome Back"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {showTwoFactor 
            ? "Enter the 6-digit code from your authenticator app."
            : "Sign in to your ORRN-AL workspace."}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (showTwoFactor) {
            handleTotpSubmit();
          } else {
            form.handleSubmit();
          }
        }}
        className="space-y-4"
      >
        {!showTwoFactor ? (
          <>
            <div>
              <form.Field name="email">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Email</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      placeholder="name@company.com"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {field.state.meta.errors.map((error) => (
                      <p key={error?.message} className="text-sm text-destructive">
                        {error?.message}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>
            </div>

            <div>
              <form.Field name="password">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Password</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {field.state.meta.errors.map((error) => (
                      <p key={error?.message} className="text-sm text-destructive">
                        {error?.message}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>
            </div>

            <form.Subscribe
              selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" className="w-full mt-2" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Signing in..." : "Sign In"}
                </Button>
              )}
            </form.Subscribe>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="totpCode">Authenticator Code</Label>
              <Input
                id="totpCode"
                type="text"
                placeholder="123456"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-xl tracking-[0.4em]"
                required
              />
            </div>

            <Button type="submit" className="w-full mt-2" disabled={isVerifyingTotp || totpCode.length !== 6}>
              {isVerifyingTotp ? "Verifying..." : "Verify & Sign In"}
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

      {!showTwoFactor && (
        <div className="mt-6 text-center text-xs text-muted-foreground border-t border-border/20 pt-4">
          Need access?{" "}
          <Link to="/waitlist" className="text-primary hover:underline font-semibold">
            Request a Demo or Join Waitlist
          </Link>
        </div>
      )}
    </div>
  );
}
