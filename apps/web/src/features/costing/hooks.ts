import { costingOn } from "@orrn/domain";
import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>["costing"];
export type CostSettingsView = Outputs["settings"]["get"];
export type SectionsView = Outputs["sections"];
export type RunsView = Outputs["runs"];
export type RunView = RunsView["items"][number];
export type ProfitView = Outputs["profitability"];
export type CapacityView = Outputs["capacity"];
export type ForecastView = Outputs["forecast"];
export type ForecastRow = ForecastView["rows"][number];
export type DiesView = Outputs["dies"];
export type DieRow = DiesView["items"][number];
export type OrderCostView = Outputs["orderLines"];

/** Costing is on for this plant: the module list names it (`costingOn`; an empty list is NOT "all on"). */
export function useCostingOn(): boolean {
  const { data: me } = useMe();
  return costingOn(me?.company?.modules);
}

/** The settings and the "may see rates" flag; the tabs that show rupees read `ratesAllowed` from here. */
export function useCostSettings(enabled = true) {
  return useQuery({ ...trpc.costing.settings.get.queryOptions(), enabled, meta: INLINE_ERROR_META });
}
