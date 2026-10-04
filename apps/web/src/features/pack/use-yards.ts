import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { trpc } from "@/shared/utils/trpc";

import { activeYards, type YardOption } from "./pack-math";

/**
 * The company's active yards for packing. Once a company has yard
 * locations the server wants one on every packing session; without any the
 * yard question is not asked.
 */
export type YardState = {
  yards: YardOption[];
  /** Active yard ids (empty: the company has no yards and packs without one). */
  yardIds: string[];
  loading: boolean;
  failed: boolean;
  retry(): void;
};

export function useYards(): YardState {
  const q = useQuery({ ...trpc.stock.locations.list.queryOptions({ includeInactive: false }), staleTime: 5 * 60_000 });
  const yards = useMemo(() => activeYards(q.data?.items), [q.data]);
  const yardIds = useMemo(() => yards.map((y) => y.id), [yards]);
  const { refetch } = q;
  const retry = useCallback(() => void refetch(), [refetch]);
  return { yards, yardIds, loading: q.isPending, failed: q.isError, retry };
}

/** Location id to code for every location, retired ones too (the session page names where its bundles went). */
export function useLocationCodes(): Map<string, string> {
  const q = useQuery({ ...trpc.stock.locations.list.queryOptions({ includeInactive: true }), staleTime: 5 * 60_000 });
  return useMemo(() => new Map((q.data?.items ?? []).map((l) => [l.id, l.code])), [q.data]);
}

const LAST_YARD_KEY = "orrn.packYard";

/**
 * The yard last packed into on this device, per company. A packing station
 * stays at one yard, so it is offered (visibly selected) next time; it is
 * only a convenience and never required.
 */
export function readLastYard(companyId: string): string | null {
  try {
    const raw = window.localStorage.getItem(LAST_YARD_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const v = map && typeof map === "object" ? map[companyId] : null;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function writeLastYard(companyId: string, locationId: string): void {
  try {
    const raw = window.localStorage.getItem(LAST_YARD_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(LAST_YARD_KEY, JSON.stringify({ ...map, [companyId]: locationId }));
  } catch {
    // Blocked storage: the packer picks the yard each time.
  }
}
