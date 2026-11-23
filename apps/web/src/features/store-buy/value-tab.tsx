import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Qty } from "@/features/store/balances-list";
import { qtyText, unitShort } from "@/features/store/store-labels";
import { StoreLoadError } from "@/features/store/store-ui";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { trpc } from "@/shared/utils/trpc";

import { buyErrorText } from "./buy-errors";
import { paiseToText, ratePaiseFromText, rupees } from "./money";
import { useInvalidateBuy, type MonthValuation, type PendingGrn, type ValuationItem } from "./use-buy";
import { defaultMonth, monthChoices, monthCsv, monthParts, toleranceBpFromText, toleranceText } from "./value-model";

type MonthRow = MonthValuation["items"][number];

/** Store value (`/store/buy`, row 73): what the store holds now, the month end report, and the over-delivery allowance. */
export function ValueTab() {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <NowSection />
      <Can do={["store.rate", "store.value"]}>
        <PendingSection />
      </Can>
      <MonthSection />
      <Can do="masters.publish">
        <AllowanceSection />
      </Can>
    </div>
  );
}

function NowSection() {
  const { t } = useT();
  const fmt = useFmt();
  const q = useQuery(trpc.store.valuation.items.queryOptions());
  const rows = q.data?.items ?? [];

  const columns: ResponsiveListColumn<ValuationItem>[] = [
    {
      key: "item",
      header: t("store2.value.columns.item"),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="break-words">{r.name}</span>
          {r.unratedMilli > 0 ? <Chip tone="amber">{t("store2.value.unrated", { qty: qtyText(t, r.unratedMilli, r.unit, fmt) })}</Chip> : null}
          {r.pendingCount > 0 ? <Chip tone="neutral">{t("store2.value.ratePending")}</Chip> : null}
          {r.unratedMilli > 0 ? (
            <Can do="store.rate">
              <OpeningRate row={r} />
            </Can>
          ) : null}
        </span>
      ),
    },
    { key: "held", header: t("store2.value.columns.held"), align: "end", cell: (r) => <Qty milli={r.heldMilli} unit={r.unit} /> },
    {
      key: "rate",
      header: t("store2.value.columns.rate"),
      align: "end",
      cell: (r) =>
        r.avgRatePaise === null ? (
          <span className="text-muted-foreground">{t("store2.value.unratedShort")}</span>
        ) : (
          <span data-no-truncate="">
            {t("store2.money.perUnit", { rate: rupees(r.avgRatePaise), unit: unitShort(t, r.unit, 1000) })}
          </span>
        ),
    },
    {
      key: "value",
      header: t("store2.value.columns.value"),
      align: "end",
      cell: (r) => <span className="font-mono font-medium tabular-nums">{rupees(r.valuePaise)}</span>,
    },
  ];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="value-now">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="value-now" className="m-0 text-[18px] font-semibold text-foreground">
            {t("store2.value.nowTitle")}
          </h2>
          <p className="m-0 text-[14px] text-muted-foreground">{t("store2.value.nowHint")}</p>
        </div>
        {q.data ? (
          <p className="m-0 text-right">
            <span className="block text-[13px] text-muted-foreground">{t("store2.value.nowTotal")}</span>
            <span className="font-mono text-[24px] font-semibold tabular-nums">{rupees(q.data.totalPaise)}</span>
          </p>
        ) : null}
      </div>
      {q.isError && !q.data ? (
        <StoreLoadError onRetry={() => void q.refetch()} />
      ) : (
        <ResponsiveList
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          label={t("store2.value.nowTitle")}
          empty={<EmptyState title={t("store2.value.nowEmpty")} />}
        />
      )}
    </section>
  );
}

/** A rate typed in rupees, per the item's unit; one form for a pending GRN and for an item's opening rate. */
function RateForm({
  unit,
  label,
  hint,
  submitLabel,
  invalidText,
  saving,
  error,
  onSubmit,
  compact,
}: {
  unit: string;
  label?: string;
  hint?: string;
  submitLabel: string;
  invalidText: string;
  saving: boolean;
  error: unknown;
  onSubmit(ratePaise: number): Promise<void>;
  compact?: boolean;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const rateLabel = label ?? t("store2.value.pending.rateLabel", { unit: unitShort(t, unit, 1000) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const paise = ratePaiseFromText(text);
    if (paise === null || paise <= 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    try {
      await onSubmit(paise);
      setText("");
    } catch {
      // Shown below.
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <div className={compact ? "flex flex-wrap items-end gap-2" : "flex flex-wrap items-end gap-3"}>
        <Field label={rateLabel} hint={hint} error={invalid ? invalidText : undefined} className="min-w-[140px] flex-1">
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v);
              setInvalid(false);
            }}
            inputMode="decimal"
            autoComplete="off"
            maxLength={14}
          />
        </Field>
        <Button type="submit" size="sm" loading={saving}>
          {submitLabel}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
          {buyErrorText(t, error)}
        </p>
      ) : null}
    </form>
  );
}

/** Rate the stock an item holds with no rate (old stock from before rates were kept). */
function OpeningRate({ row }: { row: ValuationItem }) {
  const { t } = useT();
  const invalidate = useInvalidateBuy();
  const [open, setOpen] = useState(false);
  const save = useMutation(trpc.store.valuation.setOpeningRate.mutationOptions());

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t("store2.value.opening.open")}
      </Button>
    );
  }
  return (
    <div className="flex w-full min-w-[220px] max-w-[420px] flex-col gap-2 rounded-card border border-border bg-card p-3" role="group" aria-label={t("store2.value.opening.title", { name: row.name })}>
      <RateForm
        unit={row.unit}
        label={t("store2.value.opening.label", { unit: unitShort(t, row.unit, 1000) })}
        hint={t("store2.value.opening.hint")}
        submitLabel={t("store2.value.opening.save")}
        invalidText={t("store2.value.opening.invalid")}
        saving={save.isPending}
        error={save.error}
        onSubmit={async (ratePaise) => {
          await save.mutateAsync({ itemId: row.id, ratePaise });
          toast.success(t("store2.value.opening.saved"));
          setOpen(false);
          await invalidate();
        }}
      />
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            save.reset();
            setOpen(false);
          }}
        >
          {t("store2.value.opening.close")}
        </Button>
      </div>
    </div>
  );
}

/** Deliveries taken in without a rate: the office sets each one's rate here. */
function PendingSection() {
  const { t } = useT();
  const q = useQuery(trpc.store.valuation.pending.queryOptions());
  const rows = q.data?.items ?? [];

  const columns: ResponsiveListColumn<PendingGrn>[] = [
    {
      key: "delivery",
      header: t("store2.value.pending.columns.delivery"),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium">{r.number}</span>
          {r.grnRef ? <span className="break-words text-[13px] text-muted-foreground">{r.grnRef}</span> : null}
        </span>
      ),
    },
    { key: "item", header: t("store2.value.pending.columns.item"), cell: (r) => <span className="break-words">{r.itemName}</span> },
    { key: "qty", header: t("store2.value.pending.columns.qty"), align: "end", cell: (r) => <Qty milli={r.qtyMilli} unit={r.unit} /> },
    {
      key: "value",
      header: t("store2.value.pending.columns.value"),
      align: "end",
      cell: (r) => <span className="font-mono tabular-nums">{rupees(r.valuePaise)}</span>,
    },
    {
      key: "rate",
      header: t("store2.value.pending.columns.rate"),
      cell: (r) =>
        r.canSet ? (
          <Can do="store.rate">
            <PendingRate row={r} />
          </Can>
        ) : (
          <span className="text-[13px] text-muted-foreground">{t("store2.value.pending.locked")}</span>
        ),
    },
  ];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="value-pending">
      <div className="flex flex-col gap-1">
        <h2 id="value-pending" className="m-0 text-[18px] font-semibold text-foreground">
          {t("store2.value.pending.title")}
        </h2>
        <p className="m-0 text-[14px] text-muted-foreground">{t("store2.value.pending.hint")}</p>
      </div>
      {q.isError && !q.data ? (
        <StoreLoadError onRetry={() => void q.refetch()} />
      ) : (
        <ResponsiveList
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          label={t("store2.value.pending.title")}
          empty={<EmptyState title={t("store2.value.pending.empty")} />}
        />
      )}
    </section>
  );
}

function PendingRate({ row }: { row: PendingGrn }) {
  const { t } = useT();
  const invalidate = useInvalidateBuy();
  const save = useMutation(trpc.store.valuation.setGrnRate.mutationOptions());
  return (
    <RateForm
      unit={row.unit}
      submitLabel={t("store2.value.pending.set")}
      invalidText={t("store2.value.pending.invalid")}
      saving={save.isPending}
      error={save.error}
      compact
      onSubmit={async (ratePaise) => {
        await save.mutateAsync({ txnId: row.id, ratePaise });
        toast.success(t("store2.value.pending.saved"));
        await invalidate();
      }}
    />
  );
}

function MonthSection() {
  const { t } = useT();
  const fmt = useFmt();
  const monthId = `value-month-${useId().replace(/:/g, "")}`;
  const now = useMemo(() => new Date(), []);
  const choices = useMemo(() => monthChoices(now), [now]);
  const [month, setMonth] = useState(() => defaultMonth(now));
  const q = useQuery(trpc.store.valuation.month.queryOptions({ month }));

  const label = (m: string) => {
    const p = monthParts(m);
    if (!p) return m;
    return t("store2.value.monthYear", { month: t(`store2.value.monthName.m${p.month}` as MessageKey), year: String(p.year) });
  };

  const pair = (qty: number, paise: number, unit: string) => (
    <span data-no-truncate="" className="flex flex-col items-end">
      <Qty milli={qty} unit={unit} />
      <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{rupees(paise)}</span>
    </span>
  );
  const columns: ResponsiveListColumn<MonthRow>[] = [
    { key: "item", header: t("store2.value.monthColumns.item"), cell: (r) => <span className="break-words">{r.name}</span> },
    { key: "opening", header: t("store2.value.monthColumns.opening"), align: "end", cell: (r) => pair(r.openingMilli, r.openingPaise, r.unit) },
    { key: "received", header: t("store2.value.monthColumns.received"), align: "end", cell: (r) => pair(r.inMilli, r.inPaise, r.unit) },
    { key: "issued", header: t("store2.value.monthColumns.issued"), align: "end", cell: (r) => pair(r.outMilli, r.outPaise, r.unit) },
    {
      key: "rated",
      header: t("store2.value.monthColumns.rated"),
      align: "end",
      cell: (r) => <span className="font-mono tabular-nums">{rupees(r.ratedPaise)}</span>,
    },
    {
      key: "closing",
      header: t("store2.value.monthColumns.closing"),
      align: "end",
      cell: (r) => (
        <span data-no-truncate="" className="flex flex-col items-end gap-1">
          {pair(r.closingMilli, r.closingPaise, r.unit)}
          {r.closingUnratedMilli > 0 ? (
            <Chip tone="amber">{t("store2.value.unrated", { qty: qtyText(t, r.closingUnratedMilli, r.unit, fmt) })}</Chip>
          ) : null}
        </span>
      ),
    },
  ];

  const download = () => {
    if (!q.data) return;
    const h = (k: keyof typeof headKeys) => t(`store2.value.csvHead.${k}`);
    const head = (Object.keys(headKeys) as (keyof typeof headKeys)[]).map(h);
    const text = monthCsv(head, q.data.items, q.data.totals, t("store2.value.totals"), (u) => unitShort(t, u, 1000));
    const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = t("store2.value.csvFile", { month });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const totals = q.data?.totals;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="value-month">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="value-month" className="m-0 text-[18px] font-semibold text-foreground">
          {t("store2.value.monthTitle")}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("store2.value.month")} id={monthId} className="min-w-[200px]">
            <NativeSelect id={monthId} value={month} onChange={(e) => setMonth(e.currentTarget.value)}>
              {choices.map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button variant="secondary" onClick={download} disabled={!q.data || q.data.items.length === 0}>
            <Download aria-hidden="true" strokeWidth={2} />
            {t("store2.value.download")}
          </Button>
        </div>
      </div>
      {q.isError && !q.data ? (
        <StoreLoadError onRetry={() => void q.refetch()} />
      ) : (
        <>
          <ResponsiveList
            rows={q.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.itemId}
            loading={q.isLoading}
            label={t("store2.value.monthTitle")}
            empty={<EmptyState title={t("store2.value.monthEmpty")} />}
          />
          {totals && q.data && q.data.items.length > 0 ? (
            <dl className="m-0 grid grid-cols-2 gap-3 rounded-card border border-border bg-card p-4 sm:grid-cols-5">
              {(
                [
                  ["opening", totals.openingPaise],
                  ["received", totals.inPaise],
                  ["issued", totals.outPaise],
                  ["rated", totals.ratedPaise],
                  ["closing", totals.closingPaise],
                ] as const
              ).map(([k, paise]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <dt className="text-[13px] text-muted-foreground">
                    {t("store2.value.totals")}: {t(`store2.value.monthColumns.${k}`)}
                  </dt>
                  <dd className="m-0 font-mono text-[17px] font-semibold tabular-nums">{rupees(paise)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      )}
    </section>
  );
}

const headKeys = {
  item: 1,
  unit: 1,
  openingQty: 1,
  openingValue: 1,
  receivedQty: 1,
  receivedValue: 1,
  issuedQty: 1,
  issuedValue: 1,
  ratedValue: 1,
  closingQty: 1,
  closingValue: 1,
  closingUnratedQty: 1,
};

function AllowanceSection() {
  const { t } = useT();
  const invalidate = useInvalidateBuy();
  const q = useQuery(trpc.store.settings.get.queryOptions());
  const save = useMutation(trpc.store.settings.setPoTolerance.mutationOptions());
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const current = q.data?.poOverReceiptBp;

  useEffect(() => {
    if (current !== undefined) setText(toleranceText(current));
  }, [current]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const bp = toleranceBpFromText(text);
    if (bp === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    try {
      await save.mutateAsync({ bp });
      toast.success(t("store2.value.allowance.saved"));
      await invalidate();
    } catch {
      // Shown below.
    }
  };

  return (
    <section className="flex max-w-[520px] flex-col gap-3" aria-labelledby="value-allowance">
      <div className="flex flex-col gap-1">
        <h2 id="value-allowance" className="m-0 text-[18px] font-semibold text-foreground">
          {t("store2.value.allowance.title")}
        </h2>
        <p className="m-0 text-[14px] text-muted-foreground">{t("store2.value.allowance.body")}</p>
      </div>
      {q.isError && !q.data ? (
        <StoreLoadError onRetry={() => void q.refetch()} />
      ) : (
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3">
          <Field
            label={t("store2.value.allowance.label")}
            hint={t("store2.value.allowance.hint")}
            error={invalid ? t("store2.value.allowance.invalid") : undefined}
            className="min-w-[200px] flex-1"
          >
            <NumberInput
              value={text}
              onValueChange={(v) => {
                setText(v);
                setInvalid(false);
              }}
              suffix="%"
            />
          </Field>
          <Button type="submit" loading={save.isPending} disabled={q.isLoading}>
            {t("store2.value.allowance.save")}
          </Button>
        </form>
      )}
      {save.error ? (
        <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
          {buyErrorText(t, save.error)}
        </p>
      ) : null}
    </section>
  );
}
