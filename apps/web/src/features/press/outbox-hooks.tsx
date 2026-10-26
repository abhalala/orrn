/**
 * FP-PR-19 (W4-NEXTROWS): the outbox wired to the station. `useStationSend(runId)` sends a station
 * write, or keeps it in the outbox when the tablet is offline (or when earlier writes of the run are
 * still waiting, so the order holds). `OutboxBanner` says "Offline — N changes waiting", sends the
 * list again when the connection is back, and shows each refused write with its own message.
 */
import { useT, type MessageKey, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { clearDraft } from "./count-draft";
import { isNetworkError } from "./errors";
import { pressErrorText } from "./hooks";
import { drop, enqueue, flushOutbox, isBlocked, outboxCounts, queuedReason, type OutboxItem, type OutboxKind, type OutboxStore } from "./outbox";
import { flushLease, storeFor } from "./outbox-session";

/** How often a waiting list tries again while the page thinks it is online. */
export const OUTBOX_RETRY_MS = 15_000;

function useStore(): OutboxStore | null {
  const { data: me } = useMe();
  const companyId = me?.company?.id ?? null;
  const userId = me?.user?.id ?? null;
  // One list per person per plant: the next person at this tablet never sees, let alone sends, this one.
  return companyId && userId ? storeFor(companyId, userId) : null;
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
export async function sendStationWrite(kind: OutboxKind, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const opts = signal ? { signal } : undefined;
  const runs = trpcClient.press.runs;
  switch (kind) {
    case "start":
      return runs.start.mutate(input as never, opts);
    case "stop":
      return runs.stop.mutate(input as never, opts);
    case "count":
      return runs.count.mutate(input as never, opts);
    case "resume":
      return runs.resume.mutate(input as never, opts);
    case "undoStart":
      return runs.undoStart.mutate(input as never, opts);
    case "billets":
      return runs.billets.mutate(input as never, opts);
    case "lines":
      return runs.lines.mutate(input as never, opts);
    case "scrap":
      return runs.scrap.mutate(input as never, opts);
    case "qc":
      return runs.qc.mutate(input as never, opts);
    case "close":
      return runs.close.mutate(input as never, opts);
  }
}

export type SendResult = { queued: false; out: unknown } | { queued: true; reason: "refused" | "saved" };

/** What to tell the person about a write that was queued: offline/waiting its turn, or held behind a refused change. */
export function queuedText(t: Translate, res: Extract<SendResult, { queued: true }>): string {
  return t(res.reason === "refused" ? "press.console.outbox.behind" : "press.console.outbox.queued");
}

/**
 * Send a station write now, or queue it: when the tablet is offline, or behind earlier waiting
 * writes of the same run. A refusal from the server is thrown to the caller as before.
 */
export function useStationSend(runId: string, runNumber: string | null) {
  const { store } = useOutbox();
  return useCallback(
    async (kind: OutboxKind, input: Record<string, unknown>, id?: string): Promise<SendResult> => {
      const key = id ?? (typeof input.clientMutationId === "string" ? input.clientMutationId : crypto.randomUUID());
      const queue = (): SendResult | null => {
        if (!store) return null;
        const reason = queuedReason(store.get(), runId, isOffline());
        store.set(enqueue(store.get(), { id: key, runId, runNumber, kind, input, queuedAt: Date.now(), conflict: null }));
        return { queued: true, reason };
      };
      if (store && (isOffline() || store.get().some((i) => i.runId === runId))) {
        const q = queue();
        if (q) return q;
      }
      try {
        return { queued: false, out: await sendStationWrite(kind, input) };
      } catch (e) {
        // Only a tablet that is offline queues. A request dropped while online keeps the screen's own
        // error and Try again (the same key), as before.
        if (isNetworkError(e) && isOffline()) {
          const q = queue();
          if (q) return q;
        }
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
  const blocked = isBlocked(box);
  const tRef = useRef(t);
  tRef.current = t;

  const { data: me } = useMe();
  const companyId = me?.company?.id ?? null;
  const userId = me?.user?.id ?? null;

  const flush = useCallback(async () => {
    if (!store || !companyId || !userId || flushing || outboxCounts(store.get()).waiting === 0) return;
    // Only the signed-in person's list of the active plant goes, never during a sign-out or plant switch.
    const lease = flushLease(companyId, userId);
    if (!lease) return;
    flushing = true;
    setSending(true);
    try {
      // The cookie may belong to someone else by now (another tab signed in): ask who it is before sending.
      const who = await trpcClient.auth.me.query(undefined, { signal: lease.signal });
      if (!lease.alive()) return;
      if (who.user.id !== userId || who.company?.id !== companyId) {
        void qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
        return;
      }
      const before = store.get();
      const out = await flushOutbox(
        before,
        async (item) => {
          await sendStationWrite(item.kind, item.input, lease.signal);
          if (item.kind === "close") clearDraft(item.runId);
        },
        isNetworkError,
        (e) => pressErrorText(tRef.current, e),
        (next) => store.set(mergeNew(store.get(), before, next)),
        () => !lease.alive(),
      );
      store.set(mergeNew(store.get(), before, out.box));
      if (out.sent > 0 && lease.alive()) {
        toast.success(tRef.current("press.console.outbox.sent", { count: out.sent }));
        await Promise.all([
          qc.invalidateQueries({ queryKey: trpc.press.runs.get.queryKey() }),
          qc.invalidateQueries({ queryKey: trpc.press.runs.preview.queryKey() }),
          qc.invalidateQueries({ queryKey: trpc.press.queue.list.queryKey() }),
          qc.invalidateQueries({ queryKey: trpc.press.lines.list.queryKey() }),
        ]);
      }
    } catch {
      // The who-am-I check did not get through (offline, dropped, aborted): the list waits for the next try.
    } finally {
      flushing = false;
      setSending(false);
    }
  }, [store, qc, companyId, userId]);

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
            {online && sending
              ? t("press.console.outbox.sending", { count: counts.waiting })
              : !online
                ? t("press.console.outbox.offline", { count: counts.waiting })
                : blocked
                  ? t("press.console.outbox.blocked", { count: counts.waiting })
                  : t("press.console.outbox.waiting", { count: counts.waiting })}
          </p>
          {online && !sending && !blocked ? (
            <Button variant="secondary" onClick={() => void flush()} data-outbox-retry="">
              {t("press.console.outbox.sendNow")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {counts.waiting > 0 && !blocked ? <p className="m-0 text-[15px]">{t("press.console.outbox.keepOpen")}</p> : null}
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
