import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { authClient } from "@/shared/lib/auth-client";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_public/invite/$token")({
  component: InviteComponent,
});

function InviteComponent() {
  const { token } = Route.useParams();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const acceptInviteMutation = useMutation({
    ...trpc.invite.acceptByToken.mutationOptions(),
    onSuccess: () => {
      toast.success("Successfully joined the company!");
      window.location.href = "/dashboard";
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
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Accept Invitation</CardTitle>
        <CardDescription>Join your company workspace on ORRN.</CardDescription>
      </CardHeader>

      <CardContent>
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
      </CardContent>
    </Card>
  );
}
