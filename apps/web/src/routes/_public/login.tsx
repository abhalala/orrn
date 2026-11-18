import { createI18n, useT } from "@orrn/i18n";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { loginErrorKey } from "@/features/auth/auth-errors";
import { SignInForm } from "@/features/auth/sign-in-form";
import { useFinishSignIn } from "@/features/auth/use-finish-sign-in";
import { usePageTitle } from "@/features/auth/use-page-title";
import { readStoredLocale } from "@/shared/lib/locale";

type LoginSearch = { next?: string; error?: string; via?: "google" };

export const Route = createFileRoute("/_public/login")({
  head: () => {
    const { t } = createI18n(readStoredLocale());
    return {
      meta: [
        { title: t("auth.login.title") },
        { name: "description", content: t("auth.login.subtitle") },
        { name: "robots", content: "noindex" },
        { property: "og:title", content: t("auth.login.title") },
        { property: "og:description", content: t("auth.login.subtitle") },
        { property: "og:image", content: "https://orrn.in/og.png" },
      ],
    };
  },
  component: LoginPage,
  // Plain check (no zod): route options sit in the entry chunk every page loads. `error` is a refused
  // Google sign-in (or Better Auth's error page); `via=google` is Google sending the person back signed in.
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    ...(typeof search.next === "string" ? { next: search.next } : {}),
    ...(typeof search.error === "string" && search.error
      ? { error: search.error }
      : // Better Auth's callback says a lost OAuth state this way instead of `?error=`.
        search.state === "state_not_found"
        ? { error: "state_not_found" }
        : {}),
    ...(search.via === "google" ? { via: "google" as const } : {}),
  }),
});

function LoginPage() {
  const { t } = useT();
  const { next, error, via } = Route.useSearch();

  if (via === "google" && !error) return <GoogleReturn next={next} />;

  return (
    <AuthFrame brand>
      <SignInForm
        next={next}
        alternatives
        initialError={loginErrorKey(error)}
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

/**
 * Google sent the person back signed in (`googleSignInUrls`): run the same finish as every other
 * sign-in (fresh `auth.me`, then the plant picker, /welcome, Today or `next`). With no session after
 * all, the finish goes on to `next` or Today and that page's guard brings them back here to sign in.
 */
function GoogleReturn({ next }: { next?: string }) {
  const { t } = useT();
  const finish = useFinishSignIn(next);
  const started = useRef(false);
  usePageTitle(t("auth.login.finishing"));
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void finish();
  }, [finish]);

  return (
    <AuthFrame brand>
      <div role="status" data-testid="google-return">
        <h1 className="orrn-auth-title">{t("auth.login.finishing")}</h1>
      </div>
    </AuthFrame>
  );
}
