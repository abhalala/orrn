import "@orrn/i18n/refusal-ageing";
import type { AppRouter } from "@orrn/server/routers/index";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useMemo, useState } from "react";

import { trpc } from "@/shared/utils/trpc";

import { previewReady, type LineVerdict } from "./line-preview";
import { scalePollMs, scaleView, type ScaleView } from "./scale-view";

type Out = inferRouterOutputs<AppRouter>;
export type DieCopy = Out["dieInstance"]["list"]["items"][number];
export type OrderLine = Out["orders"]["openLines"][number];
export type CastRow = Out["foundry"]["casts"]["list"]["items"][number];
export type OwnerCheck = Out["dieInstance"]["ownerCheck"];

/** A value that settles after `ms` (typing a weight asks the server once, not per keystroke). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * The server's verdict for the bundle being typed (kg/12 ft, band position, drift). Nothing here is
 * computed on the client. Debounced; the last answer stays on screen while the next one loads.
 */
export function useLinePreview(input: {
  dieId: string | null;
  dieInstanceId?: string;
  lengthMm: number;
  weightG: number | null;
  pieces: number | null;
}) {
  const settled = useDebounced(input, 200);
  const ready = previewReady(settled);
  const query = useQuery({
    ...trpc.bundle.previewLine.queryOptions({
      dieId: settled.dieId ?? "",
      ...(settled.dieInstanceId ? { dieInstanceId: settled.dieInstanceId } : {}),
      lengthMm: settled.lengthMm,
      weightG: settled.weightG ?? 1,
      pcs: settled.pieces ?? 1,
    }),
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  // Typing again hides the old answer at once when the inputs no longer make a line.
  const live = previewReady(input);
  return { verdict: live && query.data ? (query.data as LineVerdict) : null, loading: live && (query.isFetching || settled !== input) };
}

/** Server verdicts for every saved bundle of the session, in one call (result i = bundle i). */
export function useLinesPreview(
  dieId: string | null,
  dieInstanceId: string | undefined,
  lines: readonly { lengthMm: number; weightG: number; pcs: number }[],
) {
  const key = useMemo(() => JSON.stringify(lines), [lines]);
  const query = useQuery({
    ...trpc.bundle.previewLines.queryOptions({
      dieId: dieId ?? "",
      ...(dieInstanceId ? { dieInstanceId } : {}),
      lines: lines.length > 0 ? [...lines] : [{ lengthMm: 1, weightG: 1, pcs: 1 }],
    }),
    enabled: Boolean(dieId) && lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    // Same figures, same answer: React Query keys by input, `key` documents why it is stable.
    meta: { key },
  });
  const verdicts = (query.data?.lines ?? []) as LineVerdict[];
  return { verdicts: lines.length > 0 ? verdicts : [], loading: query.isFetching && lines.length > 0 };
}

/** Copies of a section, for the Source step. Nothing is asked until a section is chosen. */
export function useDieCopies(sectionId: string | null) {
  return useQuery({
    ...trpc.dieInstance.list.queryOptions({ sectionId: sectionId ?? "", limit: 50, offset: 0 }),
    enabled: Boolean(sectionId),
    staleTime: 30_000,
  });
}

/** Open order lines that still have baki for the section, oldest order first (what Pack suggests). */
export function useOpenLines(dieId: string | null) {
  return useQuery({
    ...trpc.orders.openLines.queryOptions({ dieId: dieId ?? "" }),
    enabled: Boolean(dieId),
    staleTime: 30_000,
  });
}

/** Released trolley lines of the section with pieces left (the Source step's trolley picker, W3-AG-W). */
export function useTrolleyLines(dieId: string | null) {
  return useQuery({
    ...trpc.ageing.packSource.queryOptions({ dieId: dieId ?? "", limit: 50, offset: 0 }),
    enabled: Boolean(dieId),
    staleTime: 15_000,
    meta: { inlineError: true },
  });
}

/** Casts for the picker (open and closed, newest first). */
export function useCasts() {
  return useQuery({
    ...trpc.foundry.casts.list.queryOptions({ limit: 50, offset: 0 }),
    staleTime: 60_000,
  });
}

/** The owned-die gate as a read for the section, copy and (order) customer chosen so far. */
export function useOwnerCheck(input: { dieId: string | null; dieInstanceId?: string; customerId: string | null }) {
  return useQuery({
    ...trpc.dieInstance.ownerCheck.queryOptions({
      dieId: input.dieId ?? "",
      ...(input.dieInstanceId ? { dieInstanceId: input.dieInstanceId } : {}),
      customerId: input.customerId,
      purpose: "pack",
    }),
    enabled: Boolean(input.dieId),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * The packing-bay scale. Polls `scale.reading` while the Bundles step is open: quickly when a scale
 * is connected, once in a while when there is none. A failed poll reads as "no steady weight", never
 * as an error. `lastStableG` is the last steady weight seen, kept as evidence when the packer types.
 */
export function useScale(enabled: boolean): { view: ScaleView; lastStableG: number | null; nodeId: string | null } {
  const [view, setView] = useState<ScaleView | null>(null);
  const query = useQuery({
    ...trpc.scale.reading.queryOptions(undefined),
    enabled,
    refetchInterval: () => scalePollMs(view),
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    meta: { inlineError: true },
  });
  const data = query.data;
  const next = useMemo(() => (query.isError ? scaleView({ stable: false, reason: "unreachable", configured: view?.state !== "off" && view !== null, simulated: false, nodeId: null }) : scaleView(data)), [data, query.isError, view]);
  useEffect(() => {
    setView((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [next]);
  const [lastStableG, setLastStable] = useState<number | null>(null);
  useEffect(() => {
    if (next.state === "stable") setLastStable(next.grams);
  }, [next]);
  return { view: view ?? { state: "off" }, lastStableG, nodeId: data?.nodeId ?? null };
}
