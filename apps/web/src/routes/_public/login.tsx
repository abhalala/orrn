import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

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
    <main className="grid min-h-screen w-full place-items-center px-4 py-10">
      <SignInForm next={next} />
    </main>
  );
}
