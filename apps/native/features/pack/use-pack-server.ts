import type { AppRouter } from "@orrn/server/routers/index";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useMemo, useState } from "react";

import { useDebounced } from "@/features/dispatch/use-debounced";
import { trpc } from "@/utils/trpc";

import { previewInputKey, previewInputOf, previewReady, type LineVerdict, type PreviewInput } from "./line-preview";
import { scalePollMs, scaleView, viewForReason, type ScaleView } from "./scale-view";

type Out = inferRouterOutputs<AppRouter>;
export type DieCopy = Out["dieInstance"]["list"]["items"][number];
export type OrderLine = Out["orders"]["openLines"][number];
export type CastRow = Out["foundry"]["casts"]["list"]["items"][number];
export type OwnerCheck = Out["dieInstance"]["ownerCheck"];

/**
 * The server's verdict for the bundle being typed (kg/12 ft, band position, drift). Nothing here is
 * worked out on the phone: the same bundle reads the same here, in the saved session, in the stock lists
 * and on the bundle page (D15). Debounced; the last answer stays on screen while the next one loads.
 */
export function useLinePreview(input: PreviewInput) {
  // Debounce a string key, never the object: `input` is a new object on every render, and settling on it
  // would re-render (and re-ask the server) four times a second for as long as the step is open.
  const key = previewInputKey(input);
  const settledKey = useDebounced(key, 250);
  const settled = useMemo(() => previewInputOf(settledKey), [settledKey]);
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
  return { verdict: live && query.data ? (query.data as LineVerdict) : null, loading: live && (query.isFetching || settledKey !== key) };
}

/** Server verdicts for every saved bundle of the session, in one call (result i = bundle i). */
export function useLinesPreview(dieId: string | null, dieInstanceId: string | undefined, lines: readonly { lengthMm: number; weightG: number; pcs: number }[]) {
  const query = useQuery({
    ...trpc.bundle.previewLines.queryOptions({
      dieId: dieId ?? "",
      ...(dieInstanceId ? { dieInstanceId } : {}),
      lines: lines.length > 0 ? [...lines] : [{ lengthMm: 1, weightG: 1, pcs: 1 }],
    }),
    enabled: Boolean(dieId) && lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
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

/** Casts for the picker (open and closed, newest first). */
export function useCasts() {
  return useQuery({ ...trpc.foundry.casts.list.queryOptions({ limit: 50, offset: 0 }), staleTime: 60_000 });
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
 * The packing-bay scale (FP-PK-02). Polls `scale.reading` while the Bundles step is open: quickly when a
 * scale is connected, once in a while when there is none. A failed poll reads as "no steady weight", never
 * as an error. `lastStableG` is the last steady weight seen, kept as evidence when the packer types.
 */
export function useScale(enabled: boolean): { view: ScaleView; reasonView: ScaleView; lastStableG: number | null } {
  const [view, setView] = useState<ScaleView | null>(null);
  const query = useQuery({
    ...trpc.scale.reading.queryOptions(undefined),
    enabled,
    refetchInterval: () => scalePollMs(view),
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const data = query.data;
  const next = useMemo(
    () => (query.isError ? scaleView({ stable: false, reason: "unreachable", configured: view !== null && view.state !== "off", simulated: false, nodeId: null }) : scaleView(data)),
    [data, query.isError, view],
  );
  useEffect(() => {
    setView((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [next]);
  const [lastStableG, setLastStable] = useState<number | null>(null);
  useEffect(() => {
    if (next.state === "stable") setLastStable(next.grams);
  }, [next]);
  // `view` is what the screen shows (nothing until the scale answers); `reasonView` is what a typed weight is judged against.
  return { view: view ?? { state: "off" }, reasonView: viewForReason(view), lastStableG };
}
