import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText, kgWithUnit, rateText, rupeeScreen } from "@/shared/lib/fmt-text";
import { bundleDetailPath } from "@/shared/lib/paths";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

import { CancelSheet } from "./cancel-sheet";
import { type StepDetail } from "./hooks";
import { cancelAction, percentOfBp, processWord, receiveAction, stepActions } from "./model";
import { ReceiveSheet } from "./receive-sheet";
import { Fact, Panel, Section, StatusChip } from "./ui";

type Input = StepDetail["inputs"][number];
type Output = StepDetail["outputs"][number];

const backOf = (kind: StepDetail["step"]["kind"]) => (kind === "draw" ? "/drawbench" : kind === "fabricate" ? "/fabrication" : "/jobwork");

/**
 * `/jobwork/$id`: one step of any kind. What went in, what came back, the loss and (for people who see money) the cost per kg;
 * the receive sheet and cancel for people who may act on this kind; the delivery challan for job work.
 */
export function StepScreen({ id }: { id: string }) {
  const { t } = useT();
  const q = useQuery({ ...trpc.process.steps.get.queryOptions({ id }), meta: INLINE_ERROR_META, retry: (n, e) => !isNotFound(e) && n < 2 });
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const back = { to: "/jobwork", label: t("jw.title") };

  if (q.isError && isNotFound(q.error)) {
    return (
      <>
        <PageHeader title={t("jw.step.notFound")} back={back} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("errors.notFoundInCompany")} />
        </div>
      </>
    );
  }
  if (showsQueryError(q)) {
    return (
      <>
        <PageHeader title={t("jw.title")} back={back} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("jw.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void q.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      </>
    );
  }
  if (!q.data) {
    return (
      <>
        <PageHeader title={t("jw.title")} back={back} />
        <Skeleton className="h-48 rounded-card" aria-busy="true" />
      </>
    );
  }
  const d = q.data;
  const s = d.step;
  const act = stepActions(s.status);
  return (
    <>
      <PageHeader
        title={s.number}
        subtitle={`${t(`jw.kind.${s.kind}`)} · ${t(`jw.process.${processWord(s.process)}`)}${d.vendor ? ` · ${d.vendor.name}` : ""}`}
        back={{ to: backOf(s.kind), label: s.kind === "draw" || s.kind === "fabricate" ? t(`jw.kind.${s.kind}`) : t("jw.title") }}
        actions={
          <>
            {s.kind === "jobwork" ? (
              <Can do={["jobwork.send", "jobwork.receive", "jobwork.cost"]}>
                <Button asChild variant="secondary">
                  <UiLink to={`/jobwork/${s.id}/challan`} className="no-underline" data-testid="open-challan">
                    <Printer aria-hidden="true" className="size-4" />
                    {t("jw.action.challan")}
                  </UiLink>
                </Button>
              </Can>
            ) : null}
            {act.cancel ? (
              <Can do={cancelAction(s.kind)}>
                <Button variant="secondary" onClick={() => setCancelling(true)} data-testid="cancel-step">
                  {t("jw.action.cancelStep")}
                </Button>
              </Can>
            ) : null}
            {act.receive ? (
              <Can do={receiveAction(s.kind)}>
                <Button onClick={() => setReceiving(true)} data-testid="receive-step">
                  {t("jw.action.receive")}
                </Button>
              </Can>
            ) : null}
          </>
        }
      />
      <StepFacts data={d} />
      <Totals data={d} />
      {s.status === "cancelled" && s.cancelReason ? (
        <p className="m-0 rounded-card bg-tone-amber-tint px-4 py-3 text-[14px] font-medium text-tone-amber-ink" data-testid="cancel-note">
          {t("jw.step.cancelled", { reason: s.cancelReason })}
        </p>
      ) : null}
      <InputsList data={d} />
      <ReturnsList data={d} />
      <OutputsList data={d} />
      <ReceiveSheet data={d} open={receiving} onOpenChange={setReceiving} />
      <CancelSheet data={d} open={cancelling} onOpenChange={setCancelling} />
    </>
  );
}

function StepFacts({ data }: { data: StepDetail }) {
  const { t } = useT();
  const fmt = useFmt();
  const when = useCompanyWhen();
  const s = data.step;
  const v = data.vendor;
  const facts: [string, string][] = [];
  if (v) facts.push([t("jw.field.vendor"), `${v.name} (${v.code})`]);
  if (v?.gstin) facts.push([t("jw.field.gstin"), v.gstin]);
  facts.push([t("jw.field.process"), t(`jw.process.${processWord(s.process)}`)]);
  if (s.finishCode) facts.push([t("jw.field.finishCode"), s.finishCode]);
  facts.push([t("jw.step.sent"), when(s.sentAt)]);
  if (s.expectedReturn) facts.push([t("jw.field.expectedReturn"), bookDateText(fmt, s.expectedReturn)]);
  if (s.doneAt) facts.push([t("jw.step.doneAt"), when(s.doneAt)]);
  if (s.vehicleNo) facts.push([t("jw.field.vehicleNo"), s.vehicleNo]);
  if (s.batchNo) facts.push([t("jw.field.batchNo"), s.batchNo]);
  if (s.passes) facts.push([t("jw.field.passes"), String(s.passes)]);
  if (s.outSize) facts.push([t("jw.field.outSize"), s.outSize]);
  if (s.ops.length) facts.push([t("jw.field.ops"), s.ops.map((o) => t(`jw.op.${o as "cut"}`)).join(", ")]);
  if (s.chemicals.length) facts.push([t("jw.field.chemicals"), s.chemicals.map((c) => (c.qty ? `${c.name} ${c.qty}` : c.name)).join(", ")]);
  if (data.canSeeCost) {
    if (s.ratePaisePerKg) facts.push([t("jw.rate.label"), t("jw.rate.perKg", { rate: rateText(fmt, s.ratePaisePerKg) })]);
    if (s.valuePaisePerKg) facts.push([t("jw.rate.valuePerKg"), t("jw.rate.perKg", { rate: rateText(fmt, s.valuePaisePerKg) })]);
  }
  if (s.note) facts.push([t("jw.field.note"), s.note]);
  return (
    <Panel className="flex min-w-0 flex-col gap-3" data-testid="step-facts">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={s.status} />
        <span className="text-[14px] text-muted-foreground">{t("jw.step.bundlesOut", { out: data.bundlesOut, total: data.inputs.length })}</span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
        {facts.map(([label, value]) => (
          <Fact key={label} label={label}>
            {value}
          </Fact>
        ))}
      </dl>
    </Panel>
  );
}

function Totals({ data }: { data: StepDetail }) {
  const { t } = useT();
  const fmt = useFmt();
  const tot = data.totals;
  if (data.returns.length === 0) return null;
  const gain = tot.lossG < 0;
  const items: [string, string][] = [
    [t("jw.fig.in"), kgWithUnit(fmt, tot.inputG)],
    [t("jw.fig.good"), kgWithUnit(fmt, tot.outputG)],
    [t("jw.fig.rejects"), kgWithUnit(fmt, tot.rejectG)],
    [t("jw.fig.scrap"), kgWithUnit(fmt, tot.scrapG)],
    [gain ? t("jw.fig.gain") : t("jw.fig.loss"), `${kgWithUnit(fmt, Math.abs(tot.lossG))}${tot.inputG > 0 ? ` · ${t("jw.fig.percent", { value: percentOfBp(Math.round((tot.lossG * 10_000) / tot.inputG)) })}` : ""}`],
  ];
  if (data.canSeeCost && tot.amountPaise !== null) {
    items.push([t("jw.fig.billed"), rupeeScreen(fmt, tot.amountPaise)]);
    if (tot.costPerKgPaise !== null) items.push([t("jw.rate.costPerKgLabel"), t("jw.rate.perKg", { rate: rateText(fmt, tot.costPerKgPaise) })]);
  }
  return (
    <Panel data-testid="step-totals" data-loss-g={tot.lossG}>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
        {items.map(([label, value]) => (
          <Fact key={label} label={label} mono>
            {value}
          </Fact>
        ))}
      </dl>
    </Panel>
  );
}

function InputsList({ data }: { data: StepDetail }) {
  const { t } = useT();
  const fmt = useFmt();
  const columns: ResponsiveListColumn<Input>[] = [
    {
      key: "serial",
      header: t("jw.col.bundle"),
      cell: (i) => (
        <UiLink to={bundleDetailPath({ serial: i.serial })} className="font-mono font-semibold whitespace-nowrap">
          {i.serial}
        </UiLink>
      ),
    },
    { key: "section", header: t("jw.col.section"), cell: (i) => i.sectionCode },
    { key: "length", header: t("jw.col.length"), align: "end", hideOnPhone: true, cell: (i) => fmt.q("bundle.length", i.lengthMm) },
    { key: "pcs", header: t("jw.col.pcs"), align: "end", cell: (i) => i.pcs },
    { key: "weight", header: t("jw.col.weight"), align: "end", cell: (i) => kgWithUnit(fmt, i.weightG) },
    { key: "state", header: t("jw.col.status"), cell: (i) => (i.returnId ? t("jw.step.back") : t("jw.step.out")) },
  ];
  return (
    <Section id="step-inputs" title={t("jw.step.inputs")}>
      <ResponsiveList label={t("jw.step.inputs")} columns={columns} rows={data.inputs} rowKey={(i) => i.bundleId} empty={<EmptyState title={t("jw.step.noInputs")} />} />
    </Section>
  );
}

function ReturnsList({ data }: { data: StepDetail }) {
  const { t } = useT();
  const fmt = useFmt();
  const when = useCompanyWhen();
  if (data.returns.length === 0) return null;
  return (
    <Section id="step-returns" title={t("jw.step.returns")}>
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="step-returns">
        {data.returns.map((r) => (
          <li key={r.id}>
            <Panel className="flex min-w-0 flex-col gap-3" data-testid="step-return" data-line={r.line}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-[16px] font-semibold">{t("jw.step.returnN", { n: r.line })}</h3>
                <span className="text-[14px] text-muted-foreground">
                  {when(r.receivedAt)} · {t(`jw.mode.${r.mode}`)}
                </span>
              </div>
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
                <Fact label={t("jw.fig.in")} mono>
                  {kgWithUnit(fmt, r.inputG)}
                </Fact>
                <Fact label={t("jw.fig.good")} mono>
                  {kgWithUnit(fmt, r.outputG)} · {t("jw.pick.pcs", { count: r.outputPcs })}
                </Fact>
                <Fact label={t("jw.fig.rejects")} mono>
                  {kgWithUnit(fmt, r.rejectG)}
                  {r.rejectPcs > 0 ? ` · ${t("jw.pick.pcs", { count: r.rejectPcs })}` : ""}
                </Fact>
                <Fact label={t("jw.fig.scrap")} mono>
                  {kgWithUnit(fmt, r.scrapG)}
                </Fact>
                <Fact label={r.lossG < 0 ? t("jw.fig.gain") : t("jw.fig.loss")} mono>
                  {kgWithUnit(fmt, Math.abs(r.lossG))}
                  {r.inputG > 0 ? ` · ${t("jw.fig.percent", { value: percentOfBp(Math.round((r.lossG * 10_000) / r.inputG)) })}` : ""}
                </Fact>
                {r.vendorDocNo ? <Fact label={t("jw.receive.vendorDoc")}>{r.vendorDocNo}</Fact> : null}
                {r.minutes ? <Fact label={t("jw.receive.minutes")}>{r.minutes}</Fact> : null}
                {r.passes ? <Fact label={t("jw.field.passes")}>{r.passes}</Fact> : null}
                {data.canSeeCost && r.amountPaise !== null && r.amountPaise > 0 ? <Fact label={t("jw.fig.billed")}>{rupeeScreen(fmt, r.amountPaise)}</Fact> : null}
                {data.canSeeCost && r.ratePaisePerKg ? <Fact label={t("jw.rate.label")}>{t("jw.rate.perKg", { rate: rateText(fmt, r.ratePaisePerKg) })}</Fact> : null}
              </dl>
              {r.note ? <p className="m-0 text-[14px] text-muted-foreground">{r.note}</p> : null}
            </Panel>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function OutputsList({ data }: { data: StepDetail }) {
  const { t } = useT();
  const fmt = useFmt();
  const fresh = data.outputs.filter((o) => o.inputBundleId !== o.bundleId);
  if (fresh.length === 0) return null;
  const columns: ResponsiveListColumn<Output>[] = [
    {
      key: "serial",
      header: t("jw.col.bundle"),
      cell: (o) => (
        <UiLink to={bundleDetailPath({ serial: o.serial })} className="font-mono font-semibold whitespace-nowrap">
          {o.serial}
        </UiLink>
      ),
    },
    { key: "length", header: t("jw.col.length"), align: "end", hideOnPhone: true, cell: (o) => fmt.q("bundle.length", o.lengthMm) },
    { key: "pcs", header: t("jw.col.pcs"), align: "end", cell: (o) => o.pcs },
    { key: "weight", header: t("jw.col.weight"), align: "end", cell: (o) => kgWithUnit(fmt, o.weightG) },
  ];
  return (
    <Section id="step-outputs" title={t("jw.step.outputs")} hint={t("jw.step.outputsHint")}>
      <ResponsiveList label={t("jw.step.outputs")} columns={columns} rows={fresh} rowKey={(o) => o.bundleId} empty={<EmptyState title={t("jw.step.noOutputs")} />} />
    </Section>
  );
}
