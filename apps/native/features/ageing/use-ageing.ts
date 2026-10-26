import { useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";

import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { sendOnce } from "@/lib/replay-key";
import { writeFailureKind } from "@/lib/request-timeout";
import { trpc } from "@/utils/trpc";

import { createAttempt } from "./attempt";

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

/** After an ageing write: the board and batch, Today's tile, the order strip, pack's sources and approvals. Resolves once the reads are back. */
export function useAgeingRefresh() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.ageing.pathFilter()),
        queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
        queryClient.invalidateQueries(trpc.orders.pathFilter()),
        queryClient.invalidateQueries(trpc.approval.pathFilter()),
      ]).then(() => undefined),
    [queryClient],
  );
}

export type WriteState = { pending: boolean; error: unknown; unsure: boolean };

/**
 * A write the server replays by its `clientMutationId` (load, start, temperature, take out, hardness, release).
 * One key per attempt: the same content sent again after an answer that never came reuses the key, and
 * `sendOnce` resends once with it when no reply came at all, so the server answers the repeat with the first
 * result and never writes twice. A saved write ends the attempt. After an unsure answer the board and batch are
 * read again (`onUnsure`), so the person sees what the server has before anything else is sent. Nothing
 * is queued for later; a write that did not answer stays on screen for the person. The button stays off until
 * that read is back. A key belongs to one opening of a sheet: `forget()` when it opens.
 */
export function useKeyedWrite(onUnsure: () => Promise<unknown>) {
  const attempt = useRef(createAttempt(randomId)).current;
  const [state, setState] = useState<WriteState>({ pending: false, error: null, unsure: false });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const set = (next: WriteState) => {
    if (mounted.current) setState(next);
  };

  /** Sends `call` with this attempt's key. Resolves the server's answer, or `undefined` when it failed (the error is in `state`). */
  const run = useCallback(
    async <R,>(body: unknown, call: (clientMutationId: string) => Promise<R>): Promise<R | undefined> => {
      set({ pending: true, error: null, unsure: false });
      try {
        const id = attempt.key(body);
        const res = await sendOnce((clientRequestId) => call(clientRequestId), id);
        attempt.saved();
        feedback.success();
        set({ pending: false, error: null, unsure: false });
        return res;
      } catch (error) {
        feedback.error();
        const unsure = writeFailureKind(error) === "unsure";
        // An unsure answer may have landed: keep the button busy and read again before anyone taps again.
        set({ pending: unsure, error, unsure });
        if (unsure) {
          await onUnsure().catch(() => undefined);
          set({ pending: false, error, unsure });
        }
        return undefined;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUnsure],
  );
  const reset = useCallback(() => set({ pending: false, error: null, unsure: false }), []);
  /** A new opening of a sheet starts a new key (the web does the same): a later reading with the same value is not the replay of an unsure earlier one. */
  const forget = useCallback(() => attempt.forget(), [attempt]);
  return { ...state, run, reset, forget };
}

/**
 * A write the server does not key (hold, clear hold, ask for approval). The server's status guards refuse a
 * second send ("already held", "not held", "approval already pending"), and this hook never resends on its own.
 * After an unsure answer it reads again and keeps the button off until that read is back.
 */
export function useGuardedWrite(onUnsure: () => Promise<unknown>) {
  const [state, setState] = useState<WriteState>({ pending: false, error: null, unsure: false });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const set = (next: WriteState) => {
    if (mounted.current) setState(next);
  };
  const run = useCallback(
    async <R,>(call: () => Promise<R>): Promise<R | undefined> => {
      set({ pending: true, error: null, unsure: false });
      try {
        const res = await call();
        feedback.success();
        set({ pending: false, error: null, unsure: false });
        return res;
      } catch (error) {
        feedback.error();
        const unsure = writeFailureKind(error) === "unsure";
        // Keep the button busy through the re-read: the screen must show what the server has before a second tap.
        set({ pending: unsure, error, unsure });
        if (unsure) {
          await onUnsure().catch(() => undefined);
          set({ pending: false, error, unsure });
        }
        return undefined;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUnsure],
  );
  const reset = useCallback(() => set({ pending: false, error: null, unsure: false }), []);
  return { ...state, run, reset };
}
