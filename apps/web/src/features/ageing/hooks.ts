import { useT } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";

import { minutesParts } from "./model";
import { serverRefusal } from "@/features/shared/server-refusal";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>;
export type Batch = Outputs["ageing"]["batches"]["get"];
export type BatchRow = Batch["rows"][number];
export type BatchSummary = Outputs["ageing"]["batches"]["list"]["items"][number];
export type Oven = Outputs["ageing"]["ovens"]["list"]["items"][number];
export type Trolley = Outputs["ageing"]["trolleys"]["list"]["items"][number];
export type Recipe = Outputs["ageing"]["recipes"]["list"]["items"][number];
export type AvailableLine = Outputs["ageing"]["batches"]["availableLines"]["items"][number];
export type AvailableBundle = Outputs["ageing"]["batches"]["availableBundles"]["items"][number];

/** The board polls every 30 s: the oven does not push, and a stale card must not look current. */
export const BOARD_POLL_MS = 30_000;

/** Wall clock that ticks (the soak timer on a card), so it is not a stale render. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** After an ageing write: the board and batch, Today's tile, the order strip, pack's sources and the bundle trace. */
export function useAgeingInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.ageing.pathFilter()),
        queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
        queryClient.invalidateQueries(trpc.orders.pathFilter()),
        queryClient.invalidateQueries(trpc.audit.pathFilter()),
        queryClient.invalidateQueries(trpc.approval.pathFilter()),
      ]),
    [queryClient],
  );
}

/** One idempotency key per user action (the same key for retries of one tap, a new one after success). */
export function useActionKey() {
  const ref = useRef<string | null>(null);
  const get = useCallback(() => (ref.current ??= crypto.randomUUID()), []);
  const reset = useCallback(() => {
    ref.current = null;
  }, []);
  return { get, reset };
}

/** The server's refusal as a sentence in the person's language (`ageing.refusal.*`, then the shared table). */
export function useRefusal() {
  const { t } = useT();
  return useCallback((error: unknown) => serverRefusal(t, error), [t]);
}

export function useBatch(id: string) {
  return useQuery({
    ...trpc.ageing.batches.get.queryOptions({ id }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "in_oven" || status === "out" ? BOARD_POLL_MS : false;
    },
    meta: INLINE_ERROR_META,
  });
}

export function useShifts() {
  const settings = useQuery({ ...trpc.company.getSettings.queryOptions(), meta: INLINE_ERROR_META });
  return { settings, shifts: settings.data?.shifts ?? [] };
}

/** "4 h 05 min" / "45 min" in the person's language. */
export function useDuration() {
  const { t } = useT();
  return useCallback(
    (min: number) => {
      const { h, m } = minutesParts(min);
      return h > 0 ? t("ageing.duration.hm", { h, m }) : t("ageing.duration.m", { m });
    },
    [t],
  );
}
