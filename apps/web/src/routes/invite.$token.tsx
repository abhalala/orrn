import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/invite/$token")({
  component: InviteComponent,
});

function InviteComponent() {
  const { token } = Route.useParams();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const acceptInviteMutation = useMutation({
    ...trpc.invite.acceptByToken.mutationOptions(),
    onSuccess: () => {
      toast.success("Successfully joined the company!");
      navigate({ to: "/dashboard" });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to accept invite");
      setIsSubmitting(false);
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // 1. Sign up / login via Better Auth
      const { data, error } = await authClient.signUp.email({
        email,
        password,
        name,
      });

      if (error) {
        if (error.code === "USER_ALREADY_EXISTS") {
          // If they already exist, try signing in instead
          const { error: signInError } = await authClient.signIn.email({
             email,
             password,
          });
          if (signInError) throw new Error(signInError.message || "Failed to sign in");
        } else {
          throw new Error(error.message || "Failed to create account");
        }
      }

      // 2. Accept the invite via tRPC (now that they have a session)
      acceptInviteMutation.mutate({ token, name });

    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <div className="w-full max-w-md p-8 rounded-lg border border-border bg-card shadow-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">Accept Invitation</h1>
          <p className="text-muted-foreground">Join your company on ORRN ERP.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <Button 
            type="submit" 
            className="w-full mt-2" 
            disabled={isSubmitting}
          >
            {isSubmitting ? "Processing..." : "Create Account & Join"}
          </Button>
        </form>
      </div>
    </div>
  );
}
