import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { AuthScreen } from "@/shared/components/auth-screen";
import SignInForm from "@/shared/components/sign-in-form";

const loginSearchSchema = z.object({
  next: z.string().optional(),
});

export const Route = createFileRoute("/_public/login")({
  component: RouteComponent,
  validateSearch: loginSearchSchema,
});

function RouteComponent() {
  const { next } = Route.useSearch();

  return (
    <AuthScreen>
      <SignInForm next={next} />
    </AuthScreen>
  );
}
