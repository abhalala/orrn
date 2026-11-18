import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { beginSessionChange, cancelSessionChange, warnLeaving } from "@/features/press/outbox-session";
import type { Me } from "@/shared/lib/me";
import { dropTenantQueries } from "@/shared/lib/tenant-cache";
import { useSignOutAndReset } from "@/shared/lib/use-sign-out";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { AuthFrame } from "./auth-frame";
import { FormAlert } from "./form-alert";
import { destinationAfterPick, markPlantChosen, pickerPlants, type PickerPlant } from "./plant-choice";
import { usePageTitle } from "./use-page-title";

/**
 * "Choose a plant" (plan 2026-11-18, Task 9; owner amendment item 4). Every plant with the person's
 * role there and "Setup pending" when its onboarding is open for them. Picking follows the plant
 * switcher's rules (AGENTS.md, FP-PF-17): `company.switch` (every pick, the active plant included, so
 * the server's choice is stamped), the press outbox paused and the old plant's cached queries dropped
 * only when the plant changes, then `auth.me` is read again for the picked plant before anything of it
 * renders. Then `orrn.plantChosen` is set for this tab and the person goes to that plant's welcome
 * steps when they are open, else Today (or the page they signed in for).
 */
export function ChoosePlantPage({ me, next }: { me: Me; next?: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const signOut = useSignOutAndReset();
  const plants = pickerPlants(me);
  const [picking, setPicking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const sw = useMutation(trpc.company.switch.mutationOptions());
  usePageTitle(t("auth.choosePlant.title"));

  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function pick(plant: PickerPlant) {
    if (picking) return;
    setFailed(false);
    setPicking(plant.companyId);
    const changing = plant.companyId !== me.company?.id;
    if (changing) {
      // Press changes waiting for the old plant stay saved under it; they are not sent in the other one.
      warnLeaving("plant");
      beginSessionChange();
    }
    try {
      await sw.mutateAsync({ companyId: plant.companyId });
    } catch {
      // Only a switch that did not happen unpauses the outbox: once the server has switched, the old
      // plant's press changes must stay held, whatever fails next.
      if (changing) cancelSessionChange();
      setFailed(true);
      setPicking(null);
      return;
    }
    try {
      if (changing) dropTenantQueries(queryClient);
      await queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      const fresh = (await queryClient.fetchQuery(trpc.auth.me.queryOptions())) as Me;
      markPlantChosen();
      await navigate({ href: destinationAfterPick(fresh, next), replace: true });
    } catch {
      setFailed(true);
      setPicking(null);
    }
  }

  return (
    <AuthFrame
      width="wide"
      footer={
        <div className="flex justify-center">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            disabled={picking !== null}
            onClick={() => signOut(() => void navigate({ to: "/login", replace: true }))}
          >
            {t("auth.signOut")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6" data-testid="choose-plant">
        <div className="flex flex-col gap-2">
          <h1 ref={heading} tabIndex={-1} className="orrn-auth-title">
            {t("auth.choosePlant.title")}
          </h1>
          <p className="m-0 max-w-[52ch] text-[15px] leading-6 text-muted-foreground">{t("auth.choosePlant.body")}</p>
        </div>

        {failed ? <FormAlert>{t("auth.choosePlant.failed")}</FormAlert> : null}

        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t("auth.choosePlant.title")}>
          {plants.map((plant) => {
            const busy = picking === plant.companyId;
            const role = t(`roles.${plant.role}` as MessageKey);
            return (
              <li key={plant.companyId}>
                <button
                  type="button"
                  data-testid="choose-plant-item"
                  data-company-id={plant.companyId}
                  aria-busy={busy || undefined}
                  disabled={picking !== null}
                  onClick={() => void pick(plant)}
                  className={cn(
                    "flex min-h-16 w-full min-w-0 items-center gap-3 rounded-card border border-border bg-card px-4 py-3 text-left",
                    "transition-colors duration-[var(--dur-fast)] hover:bg-surface-sunken disabled:cursor-not-allowed",
                    picking !== null && !busy && "opacity-60",
                  )}
                >
                  <Building2 aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[16px] leading-6 font-semibold break-words">{plant.name}</span>
                    <span className="text-[14px] leading-5 text-muted-foreground break-words">{role}</span>
                  </span>
                  {plant.setupPending ? (
                    <Chip tone="amber" truncate={false} data-testid="choose-plant-pending">
                      {t("auth.choosePlant.setupPending")}
                    </Chip>
                  ) : null}
                  {busy ? (
                    <Loader2 aria-label={t("auth.choosePlant.opening", { name: plant.name })} className="size-5 shrink-0 animate-spin" />
                  ) : (
                    <ChevronRight aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </AuthFrame>
  );
}
