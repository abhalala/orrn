import "@orrn/i18n/refusal-jobwork";
import { useT } from "@orrn/i18n";
import { companyToday } from "@orrn/server/lib/purchase";
import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback } from "react";

import { serverRefusal } from "@/features/shared/server-refusal";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>;
export type Pending = Outputs["process"]["steps"]["pending"];
export type PendingRow = Pending["items"][number];
export type StepRow = Outputs["process"]["steps"]["list"]["items"][number];
export type StepDetail = Outputs["process"]["steps"]["get"];
export type Vendor = Outputs["process"]["vendors"]["list"]["items"][number];
export type Challan = Outputs["process"]["steps"]["challan"];
export type OrderFinish = Outputs["process"]["forOrder"];
export type BundleSteps = NonNullable<Outputs["process"]["forBundle"]>;

/** After a job-work write: steps, vendors, the order strips, the bundle badges and the stock the bundles sit in. */
export function useJobworkInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.process.pathFilter()),
        queryClient.invalidateQueries(trpc.drawbench.pathFilter()),
        queryClient.invalidateQueries(trpc.fabrication.pathFilter()),
        queryClient.invalidateQueries(trpc.bundle.pathFilter()),
        queryClient.invalidateQueries(trpc.stock.pathFilter()),
        queryClient.invalidateQueries(trpc.orders.pathFilter()),
        queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
        queryClient.invalidateQueries(trpc.audit.pathFilter()),
      ]),
    [queryClient],
  );
}

/** The server's refusal as a sentence in the person's language (`jw.refusal.*`, then the shared table). */
export function useRefusal() {
  const { t } = useT();
  return useCallback((error: unknown) => serverRefusal(t, error), [t]);
}

/** Whether this person may see money (`jobwork.cost`): vendor rates, declared values, cost per kg. */
export function useSeesCost(): boolean {
  const { data: me } = useMe();
  return can(me, "jobwork.cost");
}

/** Today on the plant's clock (`YYYY-MM-DD`), for an expected return date that may not be in the past. */
export function useToday(): string {
  const { data: me } = useMe();
  return companyToday(me?.company?.settings ?? null, new Date());
}

/** The active yards a bundle can come back to. */
export function useYards(enabled = true) {
  const q = useQuery({ ...trpc.stock.locations.list.queryOptions({ includeInactive: false }), enabled, staleTime: 60_000, meta: INLINE_ERROR_META });
  return { ...q, yards: (q.data?.items ?? []).filter((l) => l.kind === "yard") };
}

export function useVendors(includeInactive = false, enabled = true) {
  return useQuery({ ...trpc.process.vendors.list.queryOptions({ includeInactive }), enabled, meta: INLINE_ERROR_META });
}

/** Whether the company has the job-work module on (an empty list means every module is on, as for the nav). */
export function useJobworkOn(): boolean {
  const { data: me } = useMe();
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  return modules.length === 0 || modules.includes("jobwork");
}
