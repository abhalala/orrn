/**
 * FP-PR-19 (W4-NEXTROWS): the outbox wired to the station. `useStationSend(runId)` sends a station
 * write, or keeps it in the outbox when the tablet is offline (or when earlier writes of the run are
 * still waiting, so the order holds). `OutboxBanner` says "Offline — N changes waiting", sends the
 * list again when the connection is back, and shows each refused write with its own message.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { clearDraft } from "./count-draft";
import { isNetworkError } from "./errors";
import { pressErrorText } from "./hooks";
import { createOutboxStore, drop, enqueue, flushOutbox, outboxCounts, type OutboxItem, type OutboxKind, type OutboxStore } from "./outbox";

/** How often a waiting list tries again while the page thinks it is online. */
export const OUTBOX_RETRY_MS = 15_000;

const stores = new Map<string, OutboxStore>();
function storeFor(companyId: string): OutboxStore {
  let s = stores.get(companyId);
  if (!s) {
    let storage: Storage | null = null;
    try {
      storage = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      storage = null;
    }
    s = createOutboxStore(`orrn.press.outbox.${companyId}`, storage);
    stores.set(companyId, s);
  }
  return s;
}

function useStore(): OutboxStore | null {
  const { data: me } = useMe();
  const companyId = me?.company?.id ?? null;
  return companyId ? storeFor(companyId) : null;
}

const EMPTY: readonly OutboxItem[] = [];
export function useOutbox() {
  const store = useStore();
  const box = useSyncExternalStore(
    (fn) => (store ? store.subscribe(fn) : () => {}),
    () => (store ? store.get() : EMPTY),
    () => EMPTY,
  );
  return { store, box };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** The one call per kind; the input is exactly what the screen built (its key included). */
export async function sendStationWrite(kind: OutboxKind, input: Record<string, unknown>): Promise<unknown> {
  const runs = trpcClient.press.runs;
  switch (kind) {
    case "start":
      return runs.start.mutate(input as never);
    case "stop":
      return runs.stop.mutate(input as never);
    case "count":
      return runs.count.mutate(input as never);
    case "resume":
      return runs.resume.mutate(input as never);
    case "undoStart":
      return runs.undoStart.mutate(input as never);
    case "billets":
      return runs.billets.mutate(input as never);
    case "lines":
      return runs.lines.mutate(input as never);
    case "scrap":
      return runs.scrap.mutate(input as never);
    case "qc":
      return runs.qc.mutate(input as never);
    case "close":
      return runs.close.mutate(input as never);
  }
}

export type SendResult = { queued: false; out: unknown } | { queued: true };

/**
 * Send a station write now, or queue it: when the tablet is offline, or behind earlier waiting
 * writes of the same run. A refusal from the server is thrown to the caller as before.
 */
export function useStationSend(runId: string, runNumber: string | null) {
  const { store } = useOutbox();
  return useCallback(
    async (kind: OutboxKind, input: Record<string, unknown>, id?: string): Promise<SendResult> => {
      const key = id ?? (typeof input.clientMutationId === "string" ? input.clientMutationId : crypto.randomUUID());
      const queue = () => {
        if (!store) return false;
        store.set(enqueue(store.get(), { id: key, runId, runNumber, kind, input, queuedAt: Date.now(), conflict: null }));
        return true;
      };
      if (store && (isOffline() || store.get().some((i) => i.runId === runId))) {
        queue();
        return { queued: true };
      }
      try {
        return { queued: false, out: await sendStationWrite(kind, input) };
      } catch (e) {
        // Only a tablet that is offline queues. A request dropped while online keeps the screen's own
        // error and Try again (the same key), as before.
        if (isNetworkError(e) && isOffline() && queue()) return { queued: true };
        throw e;
      }
    },
    [store, runId, runNumber],
  );
}

let flushing = false;

/** The banner, and the one place that sends the list again. Mount it once per station screen. */
export function OutboxBanner() {
  const { t } = useT();
  const qc = useQueryClient();
  const { store, box } = useOutbox();
  const online = useOnline();
  const [sending, setSending] = useState(false);
  const counts = outboxCounts(box);
  const tRef = useRef(t);
  tRef.current = t;

  const flush = useCallback(async () => {
    if (!store || flushing || outboxCounts(store.get()).waiting === 0) return;
    flushing = true;
    setSending(true);
    try {
      const before = store.get();
      const out = await flushOutbox(
        before,
        async (item) => {
          await sendStationWrite(item.kind, item.input);
          if (item.kind === "close") clearDraft(item.runId);
        },
        isNetworkError,
        (e) => pressErrorText(tRef.current, e),
        (next) => store.set(mergeNew(store.get(), before, next)),
      );
      store.set(mergeNew(store.get(), before, out.box));
      if (out.sent > 0) {
        toast.success(tRef.current("press.console.outbox.sent", { count: out.sent }));
        await Promise.all([
          qc.invalidateQueries({ queryKey: trpc.press.runs.get.queryKey() }),
          qc.invalidateQueries({ queryKey: trpc.press.runs.preview.queryKey() }),
          qc.invalidateQueries({ queryKey: trpc.press.queue.list.queryKey() }),
          qc.invalidateQueries({ queryKey: trpc.press.lines.list.queryKey() }),
        ]);
      }
    } finally {
      flushing = false;
      setSending(false);
    }
  }, [store, qc]);

  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);
  useEffect(() => {
    if (counts.waiting === 0) return;
    const id = window.setInterval(() => void flush(), OUTBOX_RETRY_MS);
    return () => window.clearInterval(id);
  }, [counts.waiting, flush]);

  if (box.length === 0) return null;
  const conflicts = box.filter((i) => i.conflict !== null);
  return (
    <section role="status" aria-live="polite" data-outbox="" data-outbox-waiting={counts.waiting} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-tone-amber-tint p-4 text-tone-amber-ink">
      {counts.waiting > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-[17px] font-semibold" data-outbox-banner="">
            {online && sending ? t("press.console.outbox.sending", { count: counts.waiting }) : !online ? t("press.console.outbox.offline", { count: counts.waiting }) : t("press.console.outbox.waiting", { count: counts.waiting })}
          </p>
          {online && !sending ? (
            <Button variant="secondary" onClick={() => void flush()} data-outbox-retry="">
              {t("press.console.outbox.sendNow")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {counts.waiting > 0 ? <p className="m-0 text-[15px]">{t("press.console.outbox.keepOpen")}</p> : null}
      {conflicts.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t("press.console.outbox.conflicts")}>
          {conflicts.map((i) => (
            <li key={i.id} data-outbox-conflict={i.kind} className="flex min-w-0 flex-col gap-1 rounded-input border border-border bg-card p-3 text-foreground">
              <p className="m-0 text-[15px] font-semibold">
                {t("press.console.outbox.notTaken", { what: t(`press.console.outbox.kind.${i.kind}` as MessageKey), run: i.runNumber ?? "" })}
              </p>
              <p className="m-0 whitespace-pre-line text-[15px]">{i.conflict}</p>
              <div>
                <Button variant="ghost" onClick={() => store?.set(drop(store.get(), i.id))} data-outbox-drop="">
                  {t("press.console.outbox.drop")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Writes queued while a flush ran (not in `before`) stay, after the flush's own result. */
function mergeNew(current: readonly OutboxItem[], before: readonly OutboxItem[], flushed: readonly OutboxItem[]): readonly OutboxItem[] {
  const had = new Set(before.map((i) => i.id));
  return [...flushed, ...current.filter((i) => !had.has(i.id))];
}
