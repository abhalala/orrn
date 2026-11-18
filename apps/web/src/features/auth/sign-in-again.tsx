import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useNavigate } from "@tanstack/react-router";

import { useSignOutAndReset } from "@/shared/lib/use-sign-out";

import { FormAlert } from "./form-alert";

/**
 * An inline failure from adding a passkey, linking or unlinking. When the server wants a recent sign-in
 * (`auth.errors.signInAgain`: the session is more than a day old), it carries a "Sign in again" button that
 * signs out and comes back to `next` after the new sign-in.
 */
export function MethodError({ error, next }: { error: MessageKey; next: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const signOut = useSignOutAndReset();
  return (
    <FormAlert>
      <span data-testid="method-error">{t(error)}</span>
      {error === "auth.errors.signInAgain" ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-2 flex"
          onClick={() => signOut(() => void navigate({ to: "/login", search: { next }, replace: true }))}
        >
          {t("settings.signIn.signInAgain")}
        </Button>
      ) : null}
    </FormAlert>
  );
}
