import { useT } from "@orrn/i18n";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { AuthFrame } from "@/features/auth/auth-frame";
import { SignInForm } from "@/features/auth/sign-in-form";

const loginSearchSchema = z.object({
  next: z.string().optional(),
});

export const Route = createFileRoute("/_public/login")({
  component: LoginPage,
  validateSearch: loginSearchSchema,
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
