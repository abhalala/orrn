import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

const loginSearchSchema = z.object({
  next: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  component: RouteComponent,
  validateSearch: loginSearchSchema,
});

function RouteComponent() {
  const { next } = Route.useSearch();
  const [showSignIn, setShowSignIn] = useState(false);

  return showSignIn ? (
    <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} next={next} />
  ) : (
    <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} next={next} />
  );
}
