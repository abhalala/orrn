import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { Note, SwitchRow } from "./ui";

/**
 * Settings > Security (plan 2026-11-18, Task 9; owner amendment item 3): the plant's "Require secure
 * sign-in" switch. When on, every member must keep a passkey, Google or the authenticator app; one who
 * has none is sent to "Secure your sign-in" the next time they enter this plant, and nobody can remove
 * their last one (COMPANY_REQUIRES_STRONG_METHOD). Only an owner flips it (the server refuses anyone
 * else and writes `company.security.update`); an admin sees the state and why they cannot change it.
 * Saved on press, like the module switches. The value is read from `auth.me` (`company.requireStrongSignIn`).
 */
export function SecurityTab() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const on = me?.company?.requireStrongSignIn === true;
  const owner = me?.company?.role === "owner";

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.security.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
      },
      onError: () => toast.error(t("settings.security.saveFailed")),
    }),
  );

  return (
    <section aria-labelledby="security-heading" className="flex min-w-0 flex-col gap-3" data-testid="settings-security">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="security-heading" className="m-0 text-[17px] font-semibold">
          {t("settings.security.title")}
        </h2>
        <Note>{t("settings.security.body")}</Note>
      </div>
      {owner ? (
        <SwitchRow
          testId="switch-requireStrongSignIn"
          label={t("settings.security.require")}
          hint={t("settings.security.requireHint")}
          on={on}
          pending={save.isPending}
          onToggle={() => save.mutate({ requireStrongSignIn: !on })}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card px-4 py-3">
            <span className="min-w-0 text-[15px] font-semibold break-words">{t("settings.security.require")}</span>
            <Chip tone={on ? "green" : "neutral"}>{on ? t("settings.modules.on") : t("settings.modules.off")}</Chip>
          </div>
          <Note testId="security-owner-only">{t("settings.security.ownerOnly")}</Note>
        </div>
      )}
    </section>
  );
}
