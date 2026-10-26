import { useT, type MessageKey } from "@orrn/i18n";
import { riseDelay } from "@orrn/ui/components/motion";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Cylinder, Flame, FlaskConical, Layers, ListChecks, MapPin, Recycle, Store, Thermometer, Timer, Truck, Container, type LucideIcon } from "lucide-react";

import { canAny } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { AGEING_MASTER_PEOPLE, masterEntries, STORE_ITEM_PEOPLE, type MasterEntry, type MasterKey } from "./masters-model";
import { useMastersAccess } from "./use-masters";

const ICONS: Record<MasterKey, LucideIcon> = {
  vendors: Truck,
  scrap: Recycle,
  storeItems: Store,
  locations: MapPin,
  sections: Layers,
  dieCopies: Cylinder,
  reasons: ListChecks,
  furnaces: Flame,
  alloys: FlaskConical,
  ovens: Thermometer,
  trolleys: Container,
  recipes: Timer,
};

const NOUNS: Record<MasterKey, MessageKey> = {
  vendors: "masters.hub.vendorsNoun",
  scrap: "masters.hub.scrapNoun",
  storeItems: "masters.hub.storeItemsNoun",
  locations: "masters.hub.locationsNoun",
  sections: "masters.hub.sectionsNoun",
  dieCopies: "masters.hub.dieCopiesNoun",
  reasons: "masters.hub.reasonsNoun",
  furnaces: "masters.hub.furnacesNoun",
  alloys: "masters.hub.alloysNoun",
  ovens: "masters.hub.ovensNoun",
  trolleys: "masters.hub.trolleysNoun",
  recipes: "masters.hub.recipesNoun",
};

/** How many entries each list holds (live ones), for the count beside it. Undefined while loading. */
function useCounts(enabled: { vendors: boolean; storeItems: boolean; foundry: boolean; ageing: boolean }) {
  const vendors = useQuery({ ...trpc.vendor.list.queryOptions({ limit: 1, offset: 0 }), enabled: enabled.vendors });
  const drafts = useQuery({
    ...trpc.vendor.list.queryOptions({ status: "draft", limit: 1, offset: 0 }),
    enabled: enabled.vendors,
  });
  const scrap = useQuery(trpc.purchase.scrapItems.list.queryOptions());
  const store = useQuery({ ...trpc.store.items.list.queryOptions(), enabled: enabled.storeItems });
  const locations = useQuery(trpc.stock.locations.list.queryOptions({ includeInactive: false }));
  const sections = useQuery(trpc.die.list.queryOptions({ limit: 1, offset: 0 }));
  const copies = useQuery(trpc.dieInstance.list.queryOptions({ limit: 1, offset: 0 }));
  const reasons = useQuery(trpc.reasonCodes.list.queryOptions());
  const furnaces = useQuery({ ...trpc.foundry.furnaces.list.queryOptions(), enabled: enabled.foundry });
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), enabled: enabled.foundry });
  const ovens = useQuery({ ...trpc.ageing.ovens.list.queryOptions({}), enabled: enabled.ageing });
  const trolleys = useQuery({ ...trpc.ageing.trolleys.list.queryOptions({}), enabled: enabled.ageing });
  const recipes = useQuery({ ...trpc.ageing.recipes.list.queryOptions({}), enabled: enabled.ageing });
  const counts: Partial<Record<MasterKey, number>> = {
    vendors: vendors.data?.total,
    scrap: scrap.data?.items.filter((i) => i.active).length,
    storeItems: store.data?.items.filter((i) => i.active).length,
    locations: locations.data?.items.length,
    sections: sections.data === undefined ? undefined : Number(sections.data.total),
    dieCopies: copies.data?.total,
    reasons: reasons.data?.filter((r) => r.active).length,
    furnaces: furnaces.data?.items.filter((f) => f.status === "active").length,
    alloys: alloys.data?.items.filter((a) => a.status === "active").length,
    ovens: ovens.data?.items.length,
    trolleys: trolleys.data?.items.length,
    recipes: recipes.data?.items.filter((r) => r.status === "active").length,
  };
  return { counts, drafts: drafts.data?.total ?? 0 };
}

/**
 * Masters (route /masters): the plant's lists in two groups, each row a link with what it holds.
 * The one loud element is the amber block for vendors the yard added at the kanta, shown only to
 * the people who confirm them and only while there are some.
 */
export function MastersHubPage() {
  const { t } = useT();
  const access = useMastersAccess();
  const entries = masterEntries(access.me);
  const { counts, drafts } = useCounts({
    vendors: access.canReadVendors,
    storeItems: canAny(access.me, STORE_ITEM_PEOPLE),
    foundry: access.canPublish,
    ageing: canAny(access.me, AGEING_MASTER_PEOPLE),
  });
  const groups = (["buying", "floor"] as const)
    .map((g) => ({ id: g, entries: entries.filter((e) => e.group === g) }))
    .filter((g) => g.entries.length > 0);

  return (
    <>
      <PageHeader title={t("masters.hub.title")} subtitle={t("masters.hub.subtitle")} />

      {access.canPublish && drafts > 0 ? (
        <StatusBlock
          tone="amber"
          title={t("masters.hub.toConfirm")}
          meta={t("masters.hub.toConfirmMeta")}
          value={drafts}
          href="/vendors?status=draft"
          className="animate-rise md:max-w-[420px]"
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-5">
        {groups.map((group, gi) => (
          <section key={group.id} aria-labelledby={`masters-${group.id}`} className="flex min-w-0 flex-col gap-3">
            <h2
              id={`masters-${group.id}`}
              className="m-0 font-display text-[20px] font-bold leading-tight tracking-[-0.02em] break-words"
            >
              {t(group.id === "buying" ? "masters.hub.buying" : "masters.hub.floor")}
            </h2>
            <ul
              className="animate-rise m-0 list-none divide-y divide-border overflow-hidden rounded-card border border-border bg-card p-0"
              style={riseDelay(gi + 1)}
            >
              {group.entries.map((entry) => (
                <li key={entry.key}>
                  <MasterRow entry={entry} count={counts[entry.key]} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function MasterRow({ entry, count }: { entry: MasterEntry; count: number | undefined }) {
  const { t } = useT();
  const Icon = ICONS[entry.key];
  return (
    <UiLink
      to={entry.to}
      className="animate-press group flex min-h-[76px] items-center gap-4 px-4 py-3.5 text-foreground no-underline transition-[background-color,scale] duration-[var(--dur-fast)] hover:bg-surface-sunken/60 focus-visible:-outline-offset-2 sm:px-5"
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground"
      >
        <Icon strokeWidth={2} className="size-[22px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-display text-[18px] font-bold leading-tight tracking-[-0.02em] break-words">
          {t(entry.titleKey)}
        </span>
        <span className="text-[14px] leading-snug text-muted-foreground break-words">{t(entry.hintKey)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end text-right">
        {count === undefined ? (
          <Skeleton className="h-6 w-8" />
        ) : (
          <>
            <span data-no-truncate="" className="font-mono text-[20px] font-semibold leading-none tabular-nums">
              {count.toLocaleString("en-IN")}
            </span>
            <span className="mt-1 text-[12px] font-medium text-muted-foreground">{t(NOUNS[entry.key], { count })}</span>
          </>
        )}
      </span>
      <ChevronRight aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 text-muted-foreground" />
    </UiLink>
  );
}
