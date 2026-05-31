import { useState } from "react";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryClient, trpc } from "../utils/trpc";

type Props = {
  /**
   * Called after the password has been successfully rotated. The parent should
   * navigate the user to their post-login destination (dashboard, /admin, etc).
   */
  onSuccess: () => void;
  /** Optional override for the heading copy. */
  title?: string;
  description?: string;
};

function getStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

/**
 * Shown on first login for users provisioned with a temporary password
 * (`user.must_change_password = true`). On success, invalidates `auth.me`
 * so the guard releases the user to the rest of the app.
 */
export default function ForcePasswordChangeForm({
  onSuccess,
  title = "Set a new password",
  description = "Your administrator issued a temporary password. Choose a permanent one to continue.",
}: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation(trpc.auth.changeInitialPassword.mutationOptions());
  const strength = getStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters long");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    try {
      await mutation.mutateAsync({ newPassword: password });
      await queryClient.invalidateQueries(trpc.auth.me.queryFilter());
      toast.success("Password updated.");
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update password";
      toast.error(message);
    }
  };

  return (
    <Card width="100%" maxWidth={420} alignSelf="center">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label
            htmlFor="new-password"
            className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono"
          >
            New password
          </Label>
          <Input
            id="new-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {password ? (
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[10px] font-mono font-bold text-muted-foreground uppercase">
                <span>Password strength</span>
                <span
                  className={
                    strength <= 2
                      ? "text-red-400"
                      : strength <= 4
                        ? "text-yellow-400"
                        : "text-emerald-400"
                  }
                >
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
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="confirm-password"
            className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono"
          >
            Confirm new password
          </Label>
          <Input
            id="confirm-password"
            type="password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        <Button
          type="submit"
          className="w-full mt-2"
          disabled={mutation.isPending || password.length < 8 || password !== confirm}
        >
          {mutation.isPending ? "Updating…" : "Update password"}
        </Button>
      </form>
      </CardContent>
    </Card>
  );
}
