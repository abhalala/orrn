import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { ReportToggle } from "@/features/reports/report-chrome";
import { kgFromG } from "@/features/press/model";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { CAST_TONE, type CastStatus } from "./model";
import { kgToG } from "./melt-form";
import { ErrorLine, LoadFailed, Note, Panel } from "./ui";

/**
 * `/foundry/stock` (FP-FD-15): billets in the store by alloy, then cast. The kg is the ledger
 * (`stock.billets`); a cast with nothing left drops to the finished list when asked for, never off
 * the page by mistake.
 */
export function FoundryStockScreen() {
  const { t } = useT();
  const [finished, setFinished] = useState(false);
  const query = useQuery({ ...trpc.foundry.stock.billets.queryOptions({ includeZero: finished }), meta: INLINE_ERROR_META });
  const header = <PageHeader title={t("foundry.stock.title")} subtitle={t("foundry.stock.subtitle")} back={{ to: "/casts", label: t("foundry.casts.title") }} />;
  if (showsQueryError(query)) return <>{header}<LoadFailed title={t("foundry.stock.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const d = query.data;
  if (!d) return <>{header}<Skeleton className="h-40 rounded-card" /></>;
  const live = d.casts.filter((c) => c.onHandG !== 0);
  const done = d.casts.filter((c) => c.onHandG === 0);
  return (
    <>
      {header}
      <ReportToggle id="stock-finished" checked={finished} onChange={setFinished} label={t("foundry.stock.showFinished")} />
      {live.length === 0 && done.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("foundry.stock.empty")} />
        </div>
      ) : (
        <>
          <p className="m-0 text-[15px] font-semibold tabular-nums" data-testid="stock-total">
            {t("foundry.stock.total", { kg: kgFromG(d.totalG) })}
          </p>
          {d.byAlloy.map((a) => {
            const casts = live.filter((c) => c.alloy === a.alloy);
            if (casts.length === 0) return null;
            return (
              <section key={a.alloy} aria-labelledby={`alloy-${a.alloy}`} className="flex min-w-0 flex-col gap-3" data-alloy={a.alloy}>
                <h2 id={`alloy-${a.alloy}`} className="m-0 flex flex-wrap items-baseline gap-3 text-[17px] font-semibold">
                  <span className="font-mono">{a.alloy}</span>
                  <span className="text-[14px] font-normal tabular-nums text-muted-foreground">{t("foundry.stock.alloyLine", { kg: kgFromG(casts.reduce((s, c) => s + c.onHandG, 0)), casts: casts.length })}</span>
                </h2>
                <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                  {casts.map((c) => (
                    <CastCard key={c.castId} c={c} />
                  ))}
                </ul>
              </section>
            );
          })}
          {finished && done.length > 0 ? (
            <section aria-labelledby="stock-done" className="flex min-w-0 flex-col gap-3" data-testid="stock-finished">
              <h2 id="stock-done" className="m-0 text-[17px] font-semibold">{t("foundry.stock.finished")}</h2>
              <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {done.map((c) => (
                  <CastCard key={c.castId} c={c} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      <Streams />
      <Button asChild variant="secondary" className="self-start">
        <UiLink to="/casts">{t("foundry.casts.title")}</UiLink>
      </Button>
    </>
  );
}

function CastCard({ c }: { c: { castId: string; number: string | null; year: number | null; alloy: string; status: string | null; onHandG: number } }) {
  const { t } = useT();
  return (
    <li className="min-w-0" data-cast={c.number ?? ""}>
      <UiLink to={`/casts/${c.castId}`} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-4 no-underline hover:border-foreground">
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-[20px] font-bold">{c.number ?? "?"}</span>
          {c.status ? <Chip tone={CAST_TONE[c.status as CastStatus] ?? "neutral"}>{t(`foundry.casts.status.${c.status as CastStatus}`)}</Chip> : null}
        </span>
        <span className="text-[13px] text-muted-foreground">{c.year ?? ""}</span>
        <span className="font-mono text-[18px] font-semibold tabular-nums">{kgFromG(c.onHandG)} {t("units.kg")}</span>
        <span className="text-[13px] text-muted-foreground">{t("foundry.stock.onHand")}</span>
      </UiLink>
    </li>
  );
}

/**
 * The return streams with what the ledger holds, and for masters.publish the opening balance (a fresh
 * plant states its plant scrap and dross once, or its first melt cannot take metal from a stream).
 */
function Streams() {
  const { t } = useT();
  const query = useQuery({ ...trpc.foundry.returnStreams.list.queryOptions(), meta: INLINE_ERROR_META });
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const items = (query.data?.items ?? []).filter((s) => s.active);
  if (items.length === 0) return null;
  return (
    <Panel id="streams-panel" title={t("foundry.stock.streams.title")} testId="streams-panel">
      <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.stock.streams.hint")}</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {items.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5" data-stream={s.code}>
            <span className="flex min-w-0 flex-col">
              <span className="font-mono text-[15px] font-semibold">{s.code}</span>
              <span className="text-[13px] text-muted-foreground break-words">{s.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-[15px] font-semibold tabular-nums" data-testid="stream-balance">{t("foundry.stock.streams.balance", { kg: kgFromG(s.balanceG) })}</span>
              <Can do="masters.publish">
                {s.hasOpening ? (
                  <span className="text-[13px] text-muted-foreground" data-testid="stream-opened">{t("foundry.stock.streams.posted")}</span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setPicked({ id: s.id, name: s.name })} data-testid="stream-opening">
                    {t("foundry.stock.streams.open")}
                  </Button>
                )}
              </Can>
            </span>
          </li>
        ))}
      </ul>
      <OpeningSheet stream={picked} onClose={() => setPicked(null)} />
    </Panel>
  );
}

function OpeningSheet({ stream, onClose }: { stream: { id: string; name: string } | null; onClose(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [kg, setKg] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  // The opening cannot be undone (the ledger is append-only), so the first press asks once more.
  const [confirming, setConfirming] = useState(false);
  const post = useMutation(
    trpc.foundry.returnStreams.opening.mutationOptions({
      onSuccess: () => {
        toast.success(t("foundry.stock.streams.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.returnStreams.pathKey() });
        done();
      },
    }),
  );
  const done = () => {
    setKg("");
    setNote("");
    setTried(false);
    setConfirming(false);
    post.reset();
    onClose();
  };
  const g = kgToG(kg);
  return (
    <Sheet
      open={stream !== null}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("foundry.stock.streams.sheetTitle", { name: stream?.name ?? "" })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={post.isPending}
            data-testid="opening-save"
            onClick={() => {
              setTried(true);
              if (!stream || g === null || g <= 0) return;
              if (!confirming) {
                setConfirming(true);
                return;
              }
              post.mutate({ streamId: stream.id, kgG: g, ...(note.trim() ? { note: note.trim() } : {}) });
            }}
          >
            {confirming ? t("foundry.stock.streams.confirmSave") : t("foundry.stock.streams.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.stock.streams.once")}</p>
        <Field label={t("foundry.stock.streams.kg")} error={tried && (g === null || g <= 0) ? t("foundry.stock.streams.kgInvalid") : undefined}>
          <NumberInput value={kg} suffix={t("units.kg")} onValueChange={(v) => { setKg(v); setConfirming(false); }} data-testid="opening-kg" />
        </Field>
        <Field label={t("foundry.stock.streams.note")}>
          <TextInput value={note} maxLength={200} onChange={(e) => setNote(e.currentTarget.value)} />
        </Field>
        {confirming && g !== null ? (
          <Note tone="amber" testId="opening-confirm">{t("foundry.stock.streams.confirm", { kg: kgFromG(g), name: stream?.name ?? "" })}</Note>
        ) : null}
        <ErrorLine error={post.error} />
      </div>
    </Sheet>
  );
}
