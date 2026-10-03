import { useT } from "@orrn/i18n";
import { Link, createFileRoute } from "@tanstack/react-router";

import { AuthFrame } from "@/features/auth/auth-frame";
import { SignInForm } from "@/features/auth/sign-in-form";

export const Route = createFileRoute("/_public/login")({
  component: LoginPage,
  // Plain check (no zod): route options sit in the entry chunk every page loads.
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search.next === "string" ? { next: search.next } : {},
});

function LoginPage() {
  const { t } = useT();
  const { next } = Route.useSearch();

  return (
    <AuthFrame brand>
      <SignInForm
        next={next}
        footer={
          <p className="m-0 border-t border-border pt-5 text-[15px] leading-6 text-muted-foreground">
            {t("auth.login.newHere")}{" "}
            <Link
              to="/request-access"
              className="inline-flex min-h-11 items-center font-semibold text-foreground underline decoration-control underline-offset-4 hover:decoration-foreground"
            >
              {t("auth.login.requestAccess")}
            </Link>
          </p>
        }
      />
    </AuthFrame>
  );
}
