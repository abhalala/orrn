import { useT, type MessageKey } from "@orrn/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@orrn/ui/components/dropdown-menu";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { beginSessionChange, cancelSessionChange, warnLeaving } from "@/features/press/outbox-session";
import { useMe } from "@/shared/lib/me";
import { dropTenantQueries } from "@/shared/lib/tenant-cache";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { switcherPlants } from "./plant-switcher-model";

/**
 * FP-PF-17: the plant switcher in the header. Shown only with more than one plant and never while
 * impersonating (`switcherPlants`). Picking a plant calls `company.switch`, drops the old plant's
 * cached queries, reloads `auth.me` and lands on Today (it leaves the old page first, so nothing of the old plant is fetched under the new one). Each plant keeps its own role.
 *
 * `variant`: `header` (phone top bar: the plant name is the trigger), `rail` (side nav: name at
 * 1024px and up, a plant icon in the narrow rail).
 */
export function PlantSwitcher({ variant }: { variant: "header" | "rail" }) {
  const { t } = useT();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const plants = switcherPlants(me);
  const current = plants?.find((p) => p.current) ?? null;

  const sw = useMutation(
    trpc.company.switch.mutationOptions({
      onSuccess: async () => {
        // Leave first: a page of the old plant (a dispatch id, a run) must not re-fetch under the new one and
        // flash "Not found". Then forget the old plant's data and learn the new one.
        await navigate({ to: "/today" as never });
        dropTenantQueries(queryClient);
        await queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      },
      onError: () => {
        cancelSessionChange();
        toast.error(t("nav.plantSwitch.failed"));
      },
    }),
  );

  if (!plants || !current) return null;

  const onPick = (companyId: string) => {
    if (companyId === current.companyId || sw.isPending) return;
    const target = plants.find((p) => p.companyId === companyId);
    if (target) toast.message(t("nav.plantSwitch.switching", { name: target.name }));
    // Press changes waiting for this plant stay saved under it; they are not sent in the other plant.
    warnLeaving("plant");
    beginSessionChange();
    sw.mutate({ companyId });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="plant-switcher"
          aria-label={`${t("nav.plantSwitch.label")}. ${t("nav.plantSwitch.current", { name: current.name })}`}
          disabled={sw.isPending}
          className={cn(
            "flex min-h-11 min-w-11 items-center gap-1.5 rounded-full text-left transition-colors duration-[var(--dur-fast)] disabled:opacity-60",
            variant === "header" && "-ml-1 min-w-0 flex-1 px-1",
            variant === "rail" &&
              "mx-auto justify-center bg-sidebar-accent px-2 text-sidebar-foreground lg:mx-0 lg:w-full lg:justify-start lg:px-3",
          )}
        >
          {variant === "rail" ? <Building2 aria-hidden="true" strokeWidth={2} className="size-[18px] shrink-0" /> : null}
          <span
            className={cn(
              "min-w-0 truncate",
              variant === "header" && "font-display text-[17px] font-bold tracking-[-0.02em]",
              variant === "rail" && "hidden flex-1 text-[14px] font-semibold lg:inline",
            )}
          >
            {current.name}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            strokeWidth={2}
            className={cn("size-4 shrink-0 opacity-70", variant === "rail" && "hidden lg:block")}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60 max-w-[calc(100vw-32px)]">
        <DropdownMenuLabel>{t("nav.plantSwitch.heading")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current.companyId} onValueChange={onPick}>
          {plants.map((p) => (
            <DropdownMenuRadioItem key={p.companyId} value={p.companyId} data-testid="plant-switcher-item" className="min-h-11">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{p.name}</span>
                <span className="truncate text-[13px] text-muted-foreground">{t(`roles.${p.role}` as MessageKey)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
