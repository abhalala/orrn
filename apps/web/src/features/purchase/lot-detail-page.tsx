/**
 * `/purchase/$id`: one scrap lot. The loud element is the kanta block (status
 * colour, party vs our kanta, the difference). Under it, the one next step
 * (weigh, raise the debit note, mark OK) with why OK is blocked when it is;
 * then the quiet facts, the D/C notes and the scrap stock postings. On phones
 * the main action also sits in a sticky bar above the tab bar.
 */
import { useT } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { motionClass } from "@orrn/ui/components/motion";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertTriangle, CircleCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { RouterLink } from "@/shared/components/router-link";
import { trpc } from "@/shared/utils/trpc";

import { APPROVAL_TONE } from "../approvals/approval-view";
import { bookDateText, kgText, pctText } from "./format";
import { readKantaG, type KantaReading } from "./kanta";
import { CancelLotDialog, NoteSheet, StoreSheet, WeightsSheet, useInvalidatePurchase } from "./lot-sheets";
import { useLotPerms } from "./lot-ui";
import { LOT_TONE, formatRate, lotNextStep, type LotStatus } from "./lot-view";

export function LotDetailPage({ id }: { id: string }) {
  const { t } = useT();
  const lotQuery = useQuery(trpc.purchase.lots.get.queryOptions({ id }));

  if (lotQuery.isLoading) {
    return (
      <>
        <PageHeader title={t("purchase.title")} back={{ to: "/purchase", label: t("purchase.title") }} />
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-[260px] rounded-hero" />
          <Skeleton className="h-14 w-48 rounded-full" />
          <Skeleton className="h-[220px] rounded-card" />
        </div>
      </>
    );
  }
  if (lotQuery.isError || !lotQuery.data) {
    const notFound = lotQuery.error?.data?.code === "NOT_FOUND";
    return (
      <>
        <PageHeader title={t("purchase.title")} back={{ to: "/purchase", label: t("purchase.title") }} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={notFound ? t("purchase.detail.notFound") : t("purchase.detail.error")}
            action={
              notFound ? (
                <Button asChild variant="secondary">
                  <RouterLink to="/purchase">{t("purchase.list.showAll")}</RouterLink>
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => lotQuery.refetch()}>
                  {t("common.retry")}
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }
  return <LotDetail data={lotQuery.data} />;
}

type LotData = inferRouterOutputs<AppRouter>["purchase"]["lots"]["get"];

function LotDetail({ data }: { data: LotData }) {
  const { t, locale } = useT();
  const perms = useLotPerms();
  const invalidate = useInvalidatePurchase();
  const { lot, notes, ledger, toleranceBp } = data;
  const status = lot.status as LotStatus;
  const reading = readKantaG(lot.partyKgG, lot.fcKgG, toleranceBp);
  const step = lotNextStep(
    {
      status,
      fcKgG: lot.fcKgG,
      shortBeyondTolerance: data.shortBeyondTolerance,
      noteCoversShort: data.noteCoversShort,
      notes: notes.map((n) => ({ status: n.status, type: n.type, reason: n.reason, boriDeductionG: n.boriDeductionG })),
    },
    perms,
  );
  // What live weight notes still have to cover (the server's rule, RP8).
  const uncoveredG = Math.max(0, reading.minNoteG - data.weightNoteKgG);

  const [sheet, setSheet] = useState<"weights" | "note" | "store" | "cancel" | null>(null);
  const [popKey, setPopKey] = useState(0);

  const stores = useQuery({
    ...trpc.stock.locations.list.queryOptions(),
    select: (d) => d.items.filter((l) => l.kind === "scrap_store"),
    enabled: step.primary === "ok",
  });

  const unload = useMutation(
    trpc.purchase.lots.advance.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success(t("purchase.detail.markedUnload"));
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const markOk = useMutation(
    trpc.purchase.lots.advance.mutationOptions({
      onSuccess: async (res) => {
        await invalidate();
        setSheet(null);
        setPopKey((k) => k + 1);
        toast.success(
          t("purchase.detail.markedOk", {
            kg: kgText("postedKgG" in res ? res.postedKgG : 0),
            location: "locationCode" in res ? res.locationCode : "",
          }),
        );
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const onOk = () => {
    const list = stores.data ?? [];
    if (list.length > 1) setSheet("store");
    else markOk.mutate({ id: lot.id, to: "ok" });
  };

  const primaryButton = (() => {
    if (step.primary === "weigh") {
      return (
        <Button size="lg" onClick={() => setSheet("weights")}>
          {t("purchase.detail.weigh")}
        </Button>
      );
    }
    if (step.primary === "note") {
      return (
        <Button size="lg" onClick={() => setSheet("note")}>
          {t("purchase.detail.raiseNote")}
        </Button>
      );
    }
    if (step.primary === "ok") {
      return (
        <Button size="lg" loading={markOk.isPending} onClick={onOk}>
          {t("purchase.detail.markOk")}
        </Button>
      );
    }
    return null;
  })();

  const pct = pctText(toleranceBp);
  let message: { tone: "warn" | "ok"; text: string } | null = null;
  if (step.blocked === "weigh") message = { tone: "warn", text: t("purchase.detail.blockedWeigh") };
  else if (step.blocked === "short") {
    const base = t("purchase.detail.blockedShort", { kg: kgText(reading.shortG), pct, min: kgText(uncoveredG) });
    message = {
      tone: "warn",
      text: perms.dcnote ? base : `${base} ${t("purchase.detail.blockedShortOffice", { min: kgText(uncoveredG) })}`,
    };
  } else if ((status === "booking" || status === "unload") && data.shortBeyondTolerance && data.noteCoversShort) {
    message = { tone: "ok", text: t("purchase.detail.noteCovers") };
  }

  const secondary: ReactNode[] = [];
  if (step.canUnload) {
    secondary.push(
      <Can key="unload" do="purchase.receipt">
        <Button variant="secondary" loading={unload.isPending} onClick={() => unload.mutate({ id: lot.id, to: "unload" })}>
          {t("purchase.detail.markUnload")}
        </Button>
      </Can>,
    );
  }
  if (step.canEditWeights && step.primary !== "weigh" && status !== "ok") {
    secondary.push(
      <Can key="weights" do="purchase.receipt">
        <Button variant="secondary" onClick={() => setSheet("weights")}>
          {t("purchase.detail.editWeights")}
        </Button>
      </Can>,
    );
  }
  if (step.canRaiseNote && step.primary !== "note") {
    secondary.push(
      <Can key="note" do="purchase.dcnote">
        <Button variant="secondary" onClick={() => setSheet("note")}>
          {t("purchase.detail.raiseNote")}
        </Button>
      </Can>,
    );
  }
  if (step.canCancel) {
    secondary.push(
      <Button key="cancel" variant="ghost" className="text-tone-red-ink" onClick={() => setSheet("cancel")}>
        {t("purchase.detail.cancel")}
      </Button>,
    );
  }

  return (
    <>
      <PageHeader
        title={lot.number}
        subtitle={bookDateText(lot.lotDate, locale)}
        back={{ to: "/purchase", label: t("purchase.title") }}
        actions={<HowToButton slug="weigh-scrap-lot" />}
      />

      <KantaHero
        key={popKey}
        pop={popKey > 0}
        status={status}
        vendor={lot.vendorName}
        material={t("purchase.material", { item: lot.itemName, grade: lot.gradeCode })}
        reading={reading}
        toleranceBp={toleranceBp}
      />

      {message || secondary.length > 0 || primaryButton ? (
        <section aria-label={t("purchase.detail.facts")} className="flex flex-col gap-3">
          {message ? (
            <p
              role="status"
              className={cn(
                "m-0 flex items-start gap-2.5 rounded-card border px-4 py-3 text-[15px] leading-6",
                message.tone === "warn"
                  ? "border-tone-red-ink/30 bg-tone-red-tint text-tone-red-ink"
                  : "border-tone-green-ink/30 bg-tone-green-tint text-tone-green-ink",
              )}
            >
              {message.tone === "warn" ? (
                <AlertTriangle aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0" />
              ) : (
                <CircleCheck aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0" />
              )}
              <span className="min-w-0 break-words">{message.text}</span>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {primaryButton ? <div className="hidden md:block">{primaryButton}</div> : null}
            {secondary}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <FactsCard data={data} />
        <div className="flex min-w-0 flex-col gap-4">
          <NotesCard notes={notes} />
          <StockCard ledger={ledger} lot={lot} status={status} />
        </div>
      </div>

      {primaryButton ? (
        <div className="sticky bottom-[calc(var(--shell-tabbar-offset)+12px)] z-10 flex rounded-card border border-border bg-card/95 p-2 shadow-md backdrop-blur-md md:hidden [&>*]:w-full">
          {primaryButton}
        </div>
      ) : null}

      <WeightsSheet open={sheet === "weights"} onOpenChange={(o) => setSheet(o ? "weights" : null)} lot={lot} toleranceBp={toleranceBp} />
      <NoteSheet
        open={sheet === "note"}
        onOpenChange={(o) => setSheet(o ? "note" : null)}
        lot={lot}
        minNoteG={uncoveredG}
        suggestG={reading.state === "short" ? Math.max(uncoveredG, reading.shortG - data.weightNoteKgG) : 0}
      />
      <StoreSheet
        open={sheet === "store"}
        onOpenChange={(o) => setSheet(o ? "store" : null)}
        stores={stores.data ?? []}
        pending={markOk.isPending}
        onConfirm={(locationId) => markOk.mutate({ id: lot.id, to: "ok", locationId })}
      />
      <CancelLotDialog open={sheet === "cancel"} onOpenChange={(o) => setSheet(o ? "cancel" : null)} lotId={lot.id} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The kanta block                                                            */
/* -------------------------------------------------------------------------- */

function KantaHero({
  status,
  vendor,
  material,
  reading,
  toleranceBp,
  pop,
}: {
  status: LotStatus;
  vendor: string;
  material: string;
  reading: KantaReading;
  toleranceBp: number;
  pop: boolean;
}) {
  const { t } = useT();
  const pct = pctText(toleranceBp);
  const diffBig = reading.diffG === null ? "-" : kgText(Math.abs(reading.diffG));
  const diffWord =
    reading.state === "incomplete"
      ? t("purchase.diffWord.incomplete")
      : reading.state === "even"
        ? t("purchase.diffWord.even")
        : reading.state === "over"
          ? t("purchase.diffWord.over")
          : reading.state === "within"
            ? t("purchase.diffWord.within", { pct })
            : t("purchase.diffWord.short", { pct });
  return (
    <section
      aria-label={t("purchase.detail.difference")}
      data-testid="kanta-hero"
      data-tone={LOT_TONE[status]}
      className={cn(
        "orrn-block orrn-block-hero orrn-block-sheen flex min-w-0 flex-col gap-5 p-5 sm:p-6",
        `orrn-block-${LOT_TONE[status]}`,
        pop && motionClass.pop,
      )}
    >
      <div className="relative flex min-w-0 flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-black/15 px-3 py-1 text-[13px] font-semibold">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {t(`purchase.lotStatus.${status}`)}
        </span>
        <p className="m-0 font-display text-[26px] leading-tight font-extrabold tracking-[-0.03em] break-words sm:text-[30px]">
          {vendor}
        </p>
        <p className="m-0 text-[15px] font-medium break-words">{material}</p>
      </div>
      <dl className="relative m-0 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
        <Figure label={t("purchase.detail.party")} value={kgText(reading.partyG ?? 0)} unit="kg" />
        <Figure label={t("purchase.detail.ours")} value={reading.fcG === null ? "-" : kgText(reading.fcG)} unit={reading.fcG === null ? "" : "kg"} />
        <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
          <dt className="text-[13px] font-semibold">{t("purchase.detail.difference")}</dt>
          <dd data-no-truncate="" className="m-0 flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-[40px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{diffBig}</span>
            {reading.diffG !== null ? <span className="text-[15px] font-semibold">kg</span> : null}
          </dd>
          <dd className="m-0 text-[14px] font-semibold break-words">{diffWord}</dd>
        </div>
      </dl>
    </section>
  );
}

function Figure({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] font-semibold">{label}</dt>
      <dd data-no-truncate="" className="m-0 flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-display text-[30px] leading-none font-extrabold tracking-[-0.035em] tabular-nums sm:text-[34px]">{value}</span>
        {unit ? <span className="text-[14px] font-semibold">{unit}</span> : null}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quiet cards                                                                */
/* -------------------------------------------------------------------------- */

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <h2 className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

function FactsCard({ data }: { data: LotData }) {
  const { t, locale } = useT();
  const { lot } = data;
  const notSet = t("purchase.detail.notSet");
  const rows: [string, ReactNode, boolean?][] = [
    [t("purchase.detail.vendor"), lot.vendorName],
    [t("purchase.detail.material"), t("purchase.material", { item: lot.itemName, grade: lot.gradeCode })],
    [t("purchase.detail.rate"), t("purchase.detail.perKg", { rate: formatRate(lot.ratePaise) }), true],
    [t("purchase.detail.payable"), `${kgText(data.payableKgG)} kg`, true],
    [t("purchase.detail.amount"), formatRate(data.amountPaise), true],
    [t("purchase.detail.billBook"), t(`purchase.billBooks.${lot.billBook}`)],
    [t("purchase.detail.partyBillNo"), lot.partyBillNo || notSet, Boolean(lot.partyBillNo)],
    [t("purchase.detail.vehicleNo"), lot.vehicleNo || notSet, Boolean(lot.vehicleNo)],
    [t("purchase.detail.origin"), lot.origin || notSet],
    [t("purchase.detail.dross"), lot.drossBp === null ? notSet : pctText(lot.drossBp), lot.drossBp !== null],
    [t("purchase.detail.date"), bookDateText(lot.lotDate, locale)],
  ];
  return (
    <Card title={t("purchase.detail.facts")}>
      {lot.status === "cancelled" && lot.cancelReason ? (
        <p className="m-0 rounded-input bg-tone-red-tint px-3 py-2 text-[14px] font-medium text-tone-red-ink">
          {t("purchase.detail.cancelledBecause", { reason: lot.cancelReason })}
        </p>
      ) : null}
      <dl className="m-0 flex flex-col divide-y divide-border">
        {rows.map(([label, value, mono]) => (
          <div key={label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-[15px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("m-0 min-w-0 text-right font-medium break-words", mono && "font-mono")}>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

type NoteRow = LotData["notes"][number];

function NotesCard({ notes }: { notes: NoteRow[] }) {
  const { t } = useT();
  return (
    <Card title={t("purchase.detail.notesTitle")}>
      {notes.length === 0 ? (
        <p className="m-0 text-[15px] text-muted-foreground">{t("purchase.detail.noNotes")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[15px] font-semibold">{n.number}</span>
                <span className="min-w-0 flex-1 text-[15px] break-words">
                  {t(`purchase.detail.noteType.${n.type}`)}, {t(`purchase.detail.noteReason.${n.reason}`).toLowerCase()}
                </span>
                <Chip tone={APPROVAL_TONE[n.status]}>{t(`status.request.${n.status}`)}</Chip>
              </div>
              <p className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[14px] text-muted-foreground">
                {n.kgDiffG > 0 ? <span>{t("purchase.detail.noteKg", { kg: kgText(n.kgDiffG) })}</span> : null}
                {n.boriDeductionG > 0 ? <span>{t("purchase.detail.noteBori", { kg: kgText(n.boriDeductionG) })}</span> : null}
                <span>{formatRate(n.amountPaise)}</span>
              </p>
              {n.note ? <p className="m-0 text-[14px] break-words text-muted-foreground">{n.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StockCard({ ledger, lot, status }: { ledger: LotData["ledger"]; lot: LotData["lot"]; status: LotStatus }) {
  const { t } = useT();
  return (
    <Card title={t("purchase.detail.stockTitle")}>
      {ledger.length === 0 ? (
        <p className="m-0 text-[15px] text-muted-foreground">
          {status === "cancelled" ? t("purchase.detail.stockNever") : t("purchase.detail.stockNone")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {ledger.map((row) => {
            const location = row.locationId === lot.locationId ? (lot.locationCode ?? "-") : "-";
            const kg = kgText(Math.abs(row.qtyG));
            return (
              <li key={row.id} className="font-mono text-[15px]">
                {row.qtyG >= 0
                  ? t("purchase.detail.stockIn", { kg, location })
                  : t("purchase.detail.stockOut", { kg, location })}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
