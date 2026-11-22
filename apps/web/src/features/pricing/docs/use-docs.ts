import { isModuleOn } from "@orrn/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

/** Whether the `pricing` module is on for this plant (empty module list means all on). */
export function usePricingOn(): boolean {
  const me = useMe();
  return isModuleOn((me.data?.company?.modules ?? []).map((m) => m.toLowerCase()), "pricing");
}

export type ComponentOption = { key: string; label: string; basis: "piece" | "order"; always: boolean };

/** The add-ons a quote line can carry: the component rows of the price master, current on today. */
export function useComponentOptions(): { options: ComponentOption[]; loading: boolean } {
  const q = useQuery({ ...trpc.pricing.rates.current.queryOptions(), meta: INLINE_ERROR_META, staleTime: 60_000 });
  const options: ComponentOption[] = [];
  for (const item of q.data?.items ?? []) {
    if (item.kind !== "component" || !item.current) continue;
    const d = (item.current.detail ?? {}) as { label?: unknown; basis?: unknown; always?: unknown };
    options.push({
      key: item.key,
      label: typeof d.label === "string" && d.label ? d.label : (item.name ?? item.key),
      basis: d.basis === "order" ? "order" : "piece",
      always: d.always === true,
    });
  }
  return { options, loading: q.isPending };
}

/** Refresh every quote, enquiry and proforma read after a write. */
export function useInvalidateDocs() {
  const qc = useQueryClient();
  return {
    quotes: () => qc.invalidateQueries({ queryKey: trpc.pricing.quotes.pathKey() }),
    enquiries: () => qc.invalidateQueries({ queryKey: trpc.pricing.enquiries.pathKey() }),
    proforma: () => qc.invalidateQueries({ queryKey: trpc.pricing.proforma.pathKey() }),
    orders: () => qc.invalidateQueries({ queryKey: trpc.orders.pathKey() }),
    today: () => qc.invalidateQueries({ queryKey: trpc.dashboard.pathKey() }),
  };
}
