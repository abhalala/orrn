import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ScanField } from "@orrn/ui/components/scan-field";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardPaste } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { bpText, chunkCodes, codesFromPaste, matchKey, matchTone, needsUnscannedConfirm, signed, varianceTotal, type ScanMatch } from "@/features/stock-count/count-model";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/stock/count/$id")({
  component: StockCountSession,
});

type Feed = { id: number; code: string; recorded: boolean; match: ScanMatch; serial: string | null };

/**
 * `/stock/count/$id` (PL-10): one count. Open: pick the yard you are standing in, scan or paste codes
 * (each answer says at once whether the system agrees: here, moved, elsewhere, not in stock, unknown),
 * watch the tally by yard and section, then close. Closing freezes the report: phantoms (in the system,
 * not seen), found, moved, and the variance by yard and by section. A yard nobody scanned asks a second
 * confirmation. Cancelling needs a reason and frees the yards.
 */
function StockCountSession() {
  const { t } = useT();
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const when = useCompanyWhen();
  const q = useQuery({ ...trpc.count.get.queryOptions({ sessionId: id, scanLimit: 20 }), retry: (n, e) => !isNotFound(e) && n < 2 });
  const [yard, setYard] = useState<string | undefined>();
  const [feed, setFeed] = useState<Feed[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dialog, setDialog] = useState<"close" | "cancel" | null>(null);
  const seq = { n: feed.length };

  if (q.isError && !q.data) {
    return (
      <>
        <PageHeader title={t("stock.count.title")} back={{ to: "/stock/count", label: t("stock.count.title") }} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={isNotFound(q.error) ? t("stock.count.notFound") : t("stock.loadError")}
            action={
              isNotFound(q.error) ? undefined : (
                <Button variant="secondary" onClick={() => void q.refetch()}>
                  {t("common.retry")}
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }
  if (!q.data) return <Skeleton className="h-64 w-full rounded-card" />;

  const { session, locations, report } = q.data;
  const open = session.status === "open";
  const currentYard = yard ?? (locations.length === 1 ? locations[0]!.id : undefined);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.count.pathKey() });

  const sendCodes = async (codes: string[]) => {
    if (!currentYard) {
      toast.error(t("stock.count.pickYard"));
      return;
    }
    try {
      for (const chunk of chunkCodes(codes)) {
        const res = await trpcClient.count.scan.mutate({ sessionId: id, locationId: currentYard, codes: chunk });
        setFeed((f) =>
          [
            ...res.results.map((r, i) => ({
              id: seq.n + f.length + i + Math.random(),
              code: r.code,
              recorded: r.outcome === "recorded",
              match: r.match as ScanMatch,
              serial: (r.bundle as { serial?: string } | null)?.serial ?? null,
            })),
            ...f,
          ].slice(0, 12),
        );
      }
      refresh();
    } catch (err) {
      toast.error(isNotFound(err) ? t("stock.count.notFound") : t("stock.count.scanFailed"));
      refresh();
    }
  };

  return (
    <>
      <PageHeader
        title={session.number}
        subtitle={locations.map((l) => l.code).join(", ")}
        back={{ to: "/stock/count", label: t("stock.count.title") }}
        actions={<Chip tone={open ? "blue" : session.status === "closed" ? "green" : "neutral"}>{t(`stock.count.status.${session.status}`)}</Chip>}
      />

      <p className="m-0 -mt-2 text-[13px] text-muted-foreground tabular-nums">
        {t("stock.count.startedBy", { when: when(session.startedAt), name: session.startedByName ?? t("pack.unknownPacker") })}
        {session.closedAt ? ` · ${t("stock.count.closedAt", { when: when(session.closedAt) })}` : ""}
        {session.cancelReason ? ` · ${t("stock.count.cancelReasonLine", { reason: session.cancelReason })}` : ""}
      </p>

      <Summary report={report} />

      {open ? (
        <Can do="stock.count">
          <section aria-labelledby="count-scan" className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
            <h2 id="count-scan" className="m-0 text-[17px] font-semibold">
              {t("stock.count.scanTitle")}
            </h2>
            {locations.length > 1 ? (
              <div role="radiogroup" aria-label={t("stock.count.yardNow")} className="flex flex-wrap gap-2">
                {locations.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={currentYard === l.id}
                    onClick={() => setYard(l.id)}
                    className={cn(
                      "inline-flex h-11 min-w-14 items-center justify-center rounded-full border px-4 font-mono text-[16px] font-semibold",
                      currentYard === l.id ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
                    )}
                  >
                    {l.code}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Field label={t("stock.count.scanLabel")} className="min-w-[14rem] flex-1">
                <ScanField onScan={(raw) => void sendCodes([raw])} placeholder="26J4086" autoFocus />
              </Field>
              <Button variant="secondary" className="self-end" onClick={() => setPasteOpen(true)}>
                <ClipboardPaste aria-hidden="true" strokeWidth={2} />
                {t("stock.count.paste")}
              </Button>
            </div>
            <ul aria-label={t("stock.count.feed")} className="m-0 flex list-none flex-col divide-y divide-border p-0" data-testid="count-feed" aria-live="polite">
              {feed.map((f) => (
                <li key={f.id} className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 py-1.5">
                  <span className="min-w-0 font-mono text-[15px] [overflow-wrap:anywhere]">{f.serial ?? f.code}</span>
                  <span className="flex items-center gap-2">
                    {!f.recorded ? <span className="text-[13px] text-muted-foreground">{t("stock.count.duplicate")}</span> : null}
                    <Chip tone={matchTone(f.match)}>{t(matchKey(f.match))}</Chip>
                  </span>
                </li>
              ))}
            </ul>
            <p className="m-0 text-[13px] text-muted-foreground tabular-nums" data-testid="count-scan-total">
              {t("stock.count.scanTotal", { count: q.data.scanTotal })}
            </p>
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button size="lg" onClick={() => setDialog("close")} data-testid="close-count">
                {t("stock.count.close")}
              </Button>
              <Button size="lg" variant="ghost" onClick={() => setDialog("cancel")} data-testid="cancel-count">
                {t("stock.count.cancel")}
              </Button>
            </div>
          </section>
        </Can>
      ) : null}

      <Variance report={report} />
      <Missing report={report} sessionId={id} closed={session.status === "closed"} onResolved={refresh} />

      <PasteSheet open={pasteOpen} onOpenChange={setPasteOpen} onSend={(codes) => sendCodes(codes)} />
      <CloseDialog open={dialog === "close"} onOpenChange={(o) => setDialog(o ? "close" : null)} sessionId={id} number={session.number} phantom={report.summary.phantom} onDone={refresh} />
      <CancelDialog open={dialog === "cancel"} onOpenChange={(o) => setDialog(o ? "cancel" : null)} sessionId={id} number={session.number} onDone={refresh} />
    </>
  );
}

function Summary({ report }: { report: any }) {
  const { t } = useT();
  const s = report.summary as { expected: number; seen: number; matched: number; phantom: number; phantomG: number; found: number; moved: number; changed: number; phantomBp: number };
  const tiles: { key: string; label: string; value: string; tone?: "amber" | "red" }[] = [
    { key: "expected", label: t("stock.count.expected"), value: s.expected.toLocaleString("en-IN") },
    { key: "seen", label: t("stock.count.seen"), value: s.seen.toLocaleString("en-IN") },
    { key: "phantom", label: t("stock.count.phantom"), value: `${s.phantom.toLocaleString("en-IN")} · ${formatKgTotal(gToKg(s.phantomG))} ${t("units.kg")}`, tone: s.phantom > 0 ? "amber" : undefined },
    { key: "found", label: t("stock.count.found"), value: s.found.toLocaleString("en-IN"), tone: s.found > 0 ? "amber" : undefined },
    { key: "moved", label: t("stock.count.moved"), value: s.moved.toLocaleString("en-IN") },
    { key: "share", label: t("stock.count.phantomShare"), value: bpText(s.phantomBp) },
  ];
  return (
    <dl data-testid="count-summary" className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((x) => (
        <div key={x.key} data-fact={x.key} className={cn("flex min-w-0 flex-col gap-0.5 rounded-card border border-border bg-card px-4 py-3", x.tone === "amber" && "border-transparent bg-tone-amber-tint text-tone-amber-ink")}>
          <dt className="text-[13px]">{x.label}</dt>
          <dd className="m-0 font-mono text-[18px] font-semibold tabular-nums break-words">{x.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type VarRow = { expected: number; counted: number; variance: number; varianceG: number; expectedG: number; countedG: number };

/** Variance per yard and per section (frozen at close; live while open). Positive = short, negative = extra. */
function Variance({ report }: { report: any }) {
  const { t } = useT();
  const byLocation = (report.variance.byLocation as (VarRow & { locationCode: string | null })[]) ?? [];
  const bySection = (report.variance.bySection as (VarRow & { sectionCode: string | null })[]) ?? [];
  if (byLocation.length === 0 && bySection.length === 0) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <VarianceTable label={t("stock.count.byYard")} rows={byLocation.map((r) => ({ key: r.locationCode ?? "-", name: r.locationCode ?? t("stock.noYard"), row: r }))} testId="variance-yard" />
      <VarianceTable label={t("stock.count.bySection")} rows={bySection.map((r) => ({ key: r.sectionCode ?? "-", name: r.sectionCode ?? t("stock.count.unknownCodes"), row: r }))} testId="variance-section" />
    </div>
  );
}

function VarianceTable({ label, rows, testId }: { label: string; rows: { key: string; name: string; row: VarRow }[]; testId: string }) {
  const { t } = useT();
  const total = varianceTotal(rows.map((r) => r.row));
  return (
    <section aria-label={label} className="min-w-0 overflow-hidden rounded-card border border-border bg-card" data-testid={testId}>
      <h3 className="m-0 border-b border-border px-4 py-3 text-[15px] font-semibold">{label}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-border text-[13px] text-muted-foreground">
              <th scope="col" className="h-10 pl-4 text-left font-semibold" />
              <th scope="col" className="px-3 text-right font-semibold">{t("stock.count.expected")}</th>
              <th scope="col" className="px-3 text-right font-semibold">{t("stock.count.counted")}</th>
              <th scope="col" className="pr-4 pl-3 text-right font-semibold">{t("stock.count.variance")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, name, row }) => (
              <tr key={key} className="border-b border-border last:border-0">
                <th scope="row" className="h-11 pl-4 text-left font-mono font-semibold">{name}</th>
                <td className="px-3 text-right font-mono tabular-nums">{row.expected}</td>
                <td className="px-3 text-right font-mono tabular-nums">{row.counted}</td>
                <td className={cn("pr-4 pl-3 text-right font-mono font-semibold tabular-nums", row.variance !== 0 && "text-tone-amber-ink")}>{signed(row.variance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground font-semibold">
              <th scope="row" className="h-11 pl-4 text-left">{t("packingList.grandTotal")}</th>
              <td className="px-3 text-right font-mono tabular-nums">{total.expected}</td>
              <td className="px-3 text-right font-mono tabular-nums">{total.counted}</td>
              <td className="pr-4 pl-3 text-right font-mono tabular-nums">{signed(total.variance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/**
 * The phantom report: bundles the system has in a counted yard that nobody saw (the missing list is
 * shown before close too), plus what was found out of place. After close the office asks for a void
 * (a manager approves it) or moves what was found to where it was seen.
 */
function Missing({ report, sessionId, closed, onResolved }: { report: any; sessionId: string; closed: boolean; onResolved(): void }) {
  const { t } = useT();
  const resolve = useMutation(trpc.count.resolve.mutationOptions());
  type Bundle = { bundleId: string; serial: string | null; sectionCode: string | null; weightG: number | null; systemLocationCode: string | null; seenLocationCode: string | null; resolution: string; seenElsewhere: unknown };
  const phantom = (report.phantom as Bundle[]) ?? [];
  const found = (report.found as { code: string; reason: string; seenLocationCode: string | null; resolution: string; resolvedBundle: Bundle | null }[]) ?? [];
  const moved = (report.moved as Bundle[]) ?? [];
  const voidable = phantom.filter((p) => p.resolution === "open" && !p.seenElsewhere).map((p) => p.bundleId);
  const placeable = [...moved, ...found.flatMap((f) => (f.resolvedBundle ? [f.resolvedBundle] : []))].filter((b) => b.resolution === "open").map((b) => b.bundleId);
  if (phantom.length === 0 && found.length === 0 && moved.length === 0) return null;

  const run = (action: "void_phantom" | "move_found", bundleIds: string[]) =>
    resolve.mutate(
      { sessionId, action, bundleIds: bundleIds.slice(0, 500) },
      {
        onSuccess: () => {
          toast.success(t(action === "void_phantom" ? "stock.count.voidAsked" : "stock.count.movedDone"));
          onResolved();
        },
        onError: () => toast.error(t("errors.generic")),
      },
    );

  return (
    <section aria-labelledby="count-missing" data-testid="phantom-report" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="count-missing" className="m-0 text-[17px] font-semibold">
          {closed ? t("stock.count.phantomReport") : t("stock.count.missingNow")}
        </h2>
        {closed ? (
          <Can do="stock.count">
            <div className="flex flex-wrap gap-2">
              {voidable.length > 0 ? (
                <Button variant="secondary" loading={resolve.isPending} onClick={() => run("void_phantom", voidable)}>
                  {t("stock.count.askVoid", { count: voidable.length })}
                </Button>
              ) : null}
              {placeable.length > 0 ? (
                <Button variant="secondary" loading={resolve.isPending} onClick={() => run("move_found", placeable)}>
                  {t("stock.count.moveFound", { count: placeable.length })}
                </Button>
              ) : null}
            </div>
          </Can>
        ) : null}
      </div>
      {phantom.length > 0 ? (
        <ul aria-label={t("stock.count.phantom")} className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border bg-card p-0">
          {phantom.slice(0, 100).map((p) => (
            <li key={p.bundleId} className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 px-4 py-2">
              <span className="font-mono text-[15px] font-semibold">{p.serial}</span>
              <span className="text-[13px] text-muted-foreground">{p.sectionCode}</span>
              <span className="font-mono text-[13px]">{p.systemLocationCode ?? t("stock.noYard")}</span>
              <span className="ml-auto font-mono text-[13px] tabular-nums">{p.weightG == null ? "" : formatKgTotal(gToKg(p.weightG))}</span>
              {p.resolution !== "open" ? <Chip tone="neutral">{t(`stock.count.resolution.${p.resolution}` as never)}</Chip> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {found.length > 0 ? (
        <ul aria-label={t("stock.count.found")} className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border bg-card p-0">
          {found.slice(0, 100).map((f, i) => (
            <li key={`${f.code}-${i}`} className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 px-4 py-2">
              <span className="font-mono text-[15px] font-semibold [overflow-wrap:anywhere]">{f.code}</span>
              <Chip tone="amber">{t(`stock.count.foundReason.${f.reason}` as never)}</Chip>
              <span className="font-mono text-[13px]">{f.seenLocationCode ?? ""}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PasteSheet({ open, onOpenChange, onSend }: { open: boolean; onOpenChange(o: boolean): void; onSend(codes: string[]): Promise<void> }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const codes = codesFromPaste(text);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={t("stock.count.paste")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={busy}
            disabled={codes.length === 0}
            onClick={async () => {
              setBusy(true);
              await onSend(codes);
              setBusy(false);
              setText("");
              onOpenChange(false);
            }}
          >
            {t("stock.count.pasteSend", { count: codes.length })}
          </Button>
        </>
      }
    >
      <Field label={t("stock.count.pasteLabel")} hint={t("stock.count.pasteHint")}>
        <TextArea value={text} onChangeText={setText} rows={8} spellCheck={false} autoCapitalize="characters" className="font-mono text-[15px]" />
      </Field>
    </Sheet>
  );
}

function CloseDialog({ open, onOpenChange, sessionId, number, phantom, onDone }: { open: boolean; onOpenChange(o: boolean): void; sessionId: string; number: string; phantom: number; onDone(): void }) {
  const { t } = useT();
  const [warn, setWarn] = useState<string | null>(null);
  const close = useMutation(trpc.count.close.mutationOptions());
  const go = (confirmUnscanned: boolean) =>
    close.mutate(
      { sessionId, confirmUnscanned },
      {
        onSuccess: () => {
          toast.success(t("stock.count.closed", { number }));
          setWarn(null);
          onOpenChange(false);
          onDone();
        },
        onError: (err) => {
          if (needsUnscannedConfirm(err)) setWarn(t("stock.count.unscannedWarn"));
          else toast.error(t("errors.generic"));
        },
      },
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (close.isPending) return;
        if (!o) setWarn(null);
        onOpenChange(o);
      }}
      title={t("stock.count.closeTitle", { number })}
      description={t("stock.count.closeBody", { count: phantom })}
      actions={
        <>
          <Button variant="secondary" disabled={close.isPending} onClick={() => onOpenChange(false)}>
            {t("common.back")}
          </Button>
          <Button loading={close.isPending} variant={warn ? "danger" : "primary"} onClick={() => go(Boolean(warn))} data-testid="confirm-close">
            {warn ? t("stock.count.closeAnyway") : t("stock.count.close")}
          </Button>
        </>
      }
    >
      {warn ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
          {warn}
        </p>
      ) : null}
    </Dialog>
  );
}

function CancelDialog({ open, onOpenChange, sessionId, number, onDone }: { open: boolean; onOpenChange(o: boolean): void; sessionId: string; number: string; onDone(): void }) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);
  const cancel = useMutation(trpc.count.cancel.mutationOptions());
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !cancel.isPending && onOpenChange(o)}
      title={t("stock.count.cancelTitle", { number })}
      description={t("stock.count.cancelBody")}
      actions={
        <>
          <Button variant="secondary" disabled={cancel.isPending} onClick={() => onOpenChange(false)}>
            {t("common.back")}
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            data-testid="confirm-cancel"
            onClick={() => {
              if (!reason.trim()) {
                setError(true);
                return;
              }
              cancel.mutate(
                { sessionId, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(t("stock.count.cancelled", { number }));
                    onOpenChange(false);
                    onDone();
                  },
                  onError: () => toast.error(t("errors.generic")),
                },
              );
            }}
          >
            {t("stock.count.cancel")}
          </Button>
        </>
      }
    >
      <Field label={t("stock.count.cancelReason")} error={error ? t("stock.count.cancelReasonRequired") : undefined}>
        <TextArea
          value={reason}
          onChangeText={(v) => {
            setReason(v);
            if (v.trim()) setError(false);
          }}
          rows={2}
          maxLength={500}
        />
      </Field>
    </Dialog>
  );
}
