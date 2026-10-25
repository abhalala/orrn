import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useYards } from "@/features/pack/use-yards";
import { bpText, coversEveryYard } from "@/features/stock-count/count-model";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/stock/count/")({
  component: StockCountList,
});

/**
 * `/stock/count`: stock counts (PL-10). The open counts to carry on with, the form that starts one over
 * chosen yards, the phantom share of the last count and the counts closed before. Every member reads;
 * starting one needs `stock.count` (packer, operator, supervisor, office).
 */
function StockCountList() {
  const { t } = useT();
  const when = useCompanyWhen();
  const list = useQuery(trpc.count.list.queryOptions({ limit: 20, offset: 0 }));
  const summary = useQuery(trpc.count.phantomSummary.queryOptions());
  const items = list.data?.items ?? [];
  const open = items.filter((c) => c.status === "open");
  const past = items.filter((c) => c.status !== "open");
  const last = summary.data?.lastCount;

  return (
    <>
      <PageHeader title={t("stock.count.title")} subtitle={t("stock.count.subtitle")} back={{ to: "/stock", label: t("stock.title") }} actions={<HowToButton slug="stock-count" />} />

      {summary.data ? (
        <section aria-label={t("stock.count.phantomTitle")} data-testid="phantom-summary" className="flex min-w-0 flex-wrap gap-3">
          <Tile label={t("stock.count.phantomOpen")} value={t("units.bundlesKg", { bundles: summary.data.open.bundles, kg: formatKgTotal(gToKg(summary.data.open.weightG)) })} />
          {last ? (
            <Tile
              label={t("stock.count.lastCount", { number: last.number })}
              value={t("stock.count.lastShare", { share: bpText(last.phantomBp), phantom: last.phantom, expected: last.expected })}
              hint={last.locationCodes.join(", ")}
            />
          ) : null}
        </section>
      ) : null}

      <Can do="stock.count">
        <StartForm />
      </Can>

      <section aria-labelledby="count-open" className="flex flex-col gap-3">
        <h2 id="count-open" className="m-0 text-[17px] font-semibold">
          {t("stock.count.openCounts")}
        </h2>
        {list.isPending ? (
          <Skeleton className="h-20 rounded-card" />
        ) : open.length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{t("stock.count.noneOpen")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="open-counts">
            {open.map((c) => (
              <li key={c.id}>
                <CountRow c={c} when={when} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section aria-labelledby="count-past" className="flex flex-col gap-3">
          <h2 id="count-past" className="m-0 text-[17px] font-semibold">
            {t("stock.count.pastCounts")}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="past-counts">
            {past.map((c) => (
              <li key={c.id}>
                <CountRow c={c} when={when} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {list.isError && !list.data ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("stock.loadError")}
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : null}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5 rounded-card border border-border bg-card px-4 py-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[17px] font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-[13px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

type ListItem = {
  id: string;
  number: string;
  status: "open" | "closed" | "cancelled";
  startedAt: Date | string | number;
  startedByName: string | null;
  /** Null until the count has been read (an open count shows its live figures on its own page). */
  expected: number | null;
  seen: number | null;
  phantom: number | null;
  phantomG: number | null;
  found: number | null;
  moved: number | null;
  locationCodes: string[];
};

function CountRow({ c, when }: { c: ListItem; when: (d: Date | string | number) => string }) {
  const { t } = useT();
  return (
    <Link
      to="/stock/count/$id"
      params={{ id: c.id }}
      data-count={c.number}
      className="animate-press flex min-h-16 min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-border bg-card px-4 py-3 no-underline transition-colors duration-[var(--dur-fast)] hover:bg-surface-sunken"
    >
      <span className="font-mono text-[16px] font-semibold">{c.number}</span>
      <Chip tone={c.status === "open" ? "blue" : c.status === "closed" ? "green" : "neutral"}>{t(`stock.count.status.${c.status}`)}</Chip>
      <span className="font-mono text-[14px]">{c.locationCodes.join(", ")}</span>
      <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">
        {c.status === "closed"
          ? t("stock.count.rowClosed", { phantom: c.phantom ?? 0, found: c.found ?? 0, expected: c.expected ?? 0 })
          : c.status === "open"
            ? t("stock.count.rowOpen", { seen: c.seen ?? 0 })
            : t("stock.count.status.cancelled")}
        {" · "}
        {when(c.startedAt)}
        {c.startedByName ? ` · ${c.startedByName}` : ""}
      </span>
    </Link>
  );
}

/** Start a count over chosen yards. A count over every active yard also expects bundles with no yard. */
function StartForm() {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const yards = useYards();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  // One key per attempt: a retry after a dropped connection returns the count it started (RP18).
  const requestId = useRef(crypto.randomUUID());
  const start = useMutation(trpc.count.start.mutationOptions());
  const every = useMemo(() => coversEveryYard(picked, yards.yardIds), [picked, yards.yardIds]);

  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const submit = () => {
    if (picked.size === 0) {
      setError(t("stock.count.pickYards"));
      return;
    }
    setError(undefined);
    start.mutate(
      { locationIds: [...picked], ...(note.trim() ? { note: note.trim() } : {}), clientRequestId: requestId.current },
      {
        onSuccess: (res) => {
          requestId.current = crypto.randomUUID();
          toast.success(t("stock.count.started", { number: res.number }));
          void queryClient.invalidateQueries({ queryKey: trpc.count.pathKey() });
          void navigate({ to: "/stock/count/$id", params: { id: res.id } });
        },
        onError: (err) => setError(err.data?.code === "CONFLICT" ? t("stock.count.yardBusy") : t("errors.generic")),
      },
    );
  };

  return (
    <section aria-labelledby="count-start" className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
      <h2 id="count-start" className="m-0 text-[17px] font-semibold">
        {t("stock.count.startTitle")}
      </h2>
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[14px] font-semibold">{t("stock.count.yardsLegend")}</legend>
        {yards.loading ? (
          <Skeleton className="h-12 rounded-input" />
        ) : yards.yards.length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{t("stock.count.noYards")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {yards.yards.map((y) => (
              <label key={y.id} className="flex min-h-12 cursor-pointer items-center gap-2 rounded-input border border-input bg-card px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <Checkbox checked={picked.has(y.id)} onCheckedChange={(v) => toggle(y.id, v === true)} aria-label={y.code} />
                <span className="font-mono text-[16px] font-semibold">{y.code}</span>
              </label>
            ))}
          </div>
        )}
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{every ? t("stock.count.everyYardHint") : t("stock.count.someYardsHint")}</p>
      </fieldset>
      <Field label={t("common.note")} hint={t("common.optional")} className="sm:max-w-[420px]">
        <TextInput value={note} onChangeText={setNote} maxLength={500} autoComplete="off" />
      </Field>
      {error ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button size="lg" className="self-start max-sm:w-full" loading={start.isPending} onClick={submit} data-testid="start-count">
        {t("stock.count.start")}
      </Button>
    </section>
  );
}
