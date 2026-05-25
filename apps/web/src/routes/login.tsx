import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import SignInForm from "@/components/sign-in-form";

const loginSearchSchema = z.object({
  next: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  component: RouteComponent,
  validateSearch: loginSearchSchema,
});

function RouteComponent() {
  const { next } = Route.useSearch();

  return <SignInForm next={next} />;
}
