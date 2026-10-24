import { useT } from "@orrn/i18n";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { OverflowMenu } from "@/features/catalog/overflow-menu";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

import { EditCardSheet } from "./card-edit";
import { FilesPanel } from "./card-files";
import { MakerPanel } from "./card-maker";
import { NitridingPanel } from "./card-nitriding";
import { ReadingsPanel } from "./card-readings";
import { RunsPanel } from "./card-runs";
import { TierPanel } from "./card-tier";
import { BandPositionChip, PercentChip, StatusChip } from "./drift-chips";
import {
  bandTitle,
  CARD_TABS,
  kgGroupedText,
  kgPerMetreText,
  milliKgText,
  wallMmText,
  type CardTab,
} from "./die-room-model";
import { PrintCard, printCard } from "./print-card";
import { ReadingPad } from "./reading-pad";
import type { CardData } from "./types";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

export type CopyCardProps = {
  copyId: string;
  tab: CardTab;
  onTab(tab: CardTab): void;
};

/** `/dies/copies/$copyId`: one physical copy, with its weight against its band and six tabs. */
export function CopyCard({ copyId, tab, onTab }: CopyCardProps) {
  const { t } = useT();
  const { data: me } = useMe();
  const [padOpen, setPadOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();

  const query = useQuery({ ...trpc.dieInstance.get.queryOptions({ id: copyId }), retry: false, meta: INLINE_ERROR_META });
  const status = query.data?.instance.status;
  const issue = useQuery({
    ...trpc.dieInstance.issues.list.queryOptions({ dieInstanceId: copyId, status: "issued" }),
    enabled: status === "in_use",
    meta: INLINE_ERROR_META,
  });

  const retire = useMutation({
    ...trpc.dieInstance.update.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      setRetiring(false);
      toast.success(t("dieRoom.card.retired"));
    },
    onError: (e) => {
      setRetiring(false);
      toast.error(refusal(e));
    },
  });

  const back = { to: "/dies", label: t("nav.dies") };

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-12 w-1/2 max-w-[320px]" />
        <Skeleton className="h-[160px] rounded-card" />
      </div>
    );
  }
  if (showsQueryError(query) || !query.data) {
    const missing = isNotFound(query.error);
    return (
      <>
        <PageHeader back={back} title={t("dieRoom.card.title")} />
        <EmptyState
          title={missing ? t("dieRoom.card.notFound") : t("dieRoom.card.loadFailed")}
          action={
            missing ? (
              <Button asChild variant="secondary">
                <Link to="/dies">{t("dies.detail.backToList")}</Link>
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => query.refetch()}>
                {t("common.retry")}
              </Button>
            )
          }
        />
      </>
    );
  }

  const card: CardData = query.data;
  const { instance, section, band } = card;
  const retired = instance.status === "retired";
  const sectionBack = section ? { to: `/dies/${section.id}`, label: `${section.series} ${section.sectionCode}` } : back;
  const shape = [
    section?.profileKind ? t(`dieRoom.card.${section.profileKind}`) : null,
    [section?.alloy, section?.temper].filter(Boolean).join(" ") || null,
    instance.tierRank == null ? t("dieRoom.copies.untiered") : t("dieRoom.copies.tier", { rank: instance.tierRank }),
  ].filter(Boolean);
  const latest = card.currentMilli;
  const openLine = issue.data?.items[0]?.pressLineCode ?? null;

  const tabItems = CARD_TABS.map((id) => ({ id, label: t(`dieRoom.tabs.${id}`) }));
  const overflow = [
    {
      key: "print",
      label: t("dieRoom.print.button"),
      icon: <Printer aria-hidden="true" strokeWidth={2} />,
      onSelect: printCard,
    },
    ...(can(me, "die.card") || can(me, "masters.publish")
      ? [
          {
            key: "edit",
            label: t("dieRoom.card.edit"),
            icon: <Pencil aria-hidden="true" strokeWidth={2} />,
            onSelect: () => setEditing(true),
          },
          ...(instance.status === "available"
            ? [
                {
                  key: "retire",
                  label: t("dieRoom.card.retire"),
                  icon: <Trash2 aria-hidden="true" strokeWidth={2} />,
                  onSelect: () => setRetiring(true),
                  danger: true,
                },
              ]
            : []),
        ]
      : []),
  ];

  return (
    <>
      <div className="die-screen contents">
        <PageHeader
          back={sectionBack}
          title={instance.code}
          subtitle={shape.join(" · ")}
          actions={
            <>
              <StatusChip status={instance.status} />
              <OverflowMenu items={overflow} />
              <Can do="die.reading">
                <Button onClick={() => setPadOpen(true)} disabled={retired}>
                  <Plus aria-hidden="true" strokeWidth={2} />
                  {t("dieRoom.reading.add")}
                </Button>
              </Can>
            </>
          }
        />

        <div className="flex flex-col gap-2" aria-live="polite">
          {latest == null ? (
            <p className="m-0 text-[17px] font-semibold">{t("dieRoom.card.noReading")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
              <p data-no-truncate="" className="m-0 font-mono text-[40px] leading-none font-semibold tabular-nums" data-testid="current-weight">
                {milliKgText(latest)}
                <span className="ml-2 text-[15px] font-medium text-muted-foreground">{t("units.kgPer12ft")}</span>
              </p>
              <p data-no-truncate="" className="m-0 font-mono text-[20px] font-semibold tabular-nums" data-testid="current-kgm">
                {kgPerMetreText(card.kgPerMetre)} {t("units.kgPerMetre")}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span data-testid="current-chips" className="flex flex-wrap items-center gap-2">
              <PercentChip tone={card.tone} pctTenth={card.pctTenth} />
              <BandPositionChip position={card.position} />
            </span>
            {band ? (
              <Badge tone="neutral" className="font-mono tabular-nums">
                {bandTitle(band, t("units.mm"), t("units.kgPer12ft"))}
              </Badge>
            ) : null}
            {card.pendingTierChange ? (
              <Chip tone="amber" truncate={false}>
                {t("dieRoom.tier.waitingManager")}
              </Chip>
            ) : null}
            {card.lifeReached ? (
              <Chip tone="red" truncate={false}>
                {t("dieRoom.card.lifeReached")}
              </Chip>
            ) : null}
          </div>
          {instance.lifeG != null ? (
            <p className="m-0 text-[15px] font-semibold tabular-nums">
              {t("dieRoom.card.lifeLine", { produced: kgGroupedText(card.producedG), life: kgGroupedText(instance.lifeG) })}
            </p>
          ) : null}
          {instance.status === "in_use" ? (
            <p className="m-0 text-[14px] text-muted-foreground">
              {openLine ? t("dieRoom.issue.issued", { line: openLine }) : t("dieRoom.card.onPress")}{" "}
              <Link to="/dies/issues" className="font-semibold text-foreground">
                {t("dieRoom.board.issueLink")}
              </Link>
            </p>
          ) : null}
          {card.owner ? (
            <p className="m-0 text-[14px] text-muted-foreground">
              {t("dieRoom.card.ownerLabel")} <span className="font-semibold text-foreground">{card.owner.name ?? ""}</span>
            </p>
          ) : null}
        </div>

        <Card className="min-w-0">
          <CardTitle>{t("dieRoom.card.cardTitle")}</CardTitle>
          <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Fact label={t("dieRoom.card.cavities")} value={card.cavityCount == null ? null : String(card.cavityCount)} />
            <Fact label={t("dieRoom.card.bolster")} value={instance.bolster} mono />
            <Fact label={t("dieRoom.card.wall")} value={band && band.wallTenthMm > 0 ? `${wallMmText(band.wallTenthMm)} ${t("units.mm")}` : null} />
            <Fact label={t("dieRoom.card.trial")} value={instance.trialKgPer12ftMilli == null ? null : `${milliKgText(instance.trialKgPer12ftMilli)} ${t("units.kgPer12ft")}`} mono />
            <Fact label={t("dieRoom.card.hardness")} value={instance.hardness == null ? null : String(instance.hardness)} />
            <Fact label={t("dieRoom.copies.rack")} value={instance.rackNo} mono />
          </dl>
          <details className="rounded-card border border-border p-3">
            <summary className="min-h-11 cursor-pointer text-[15px] leading-[44px] font-semibold">{t("common.advanced")}</summary>
            <dl className="m-0 mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Fact label={t("dieRoom.card.backer")} value={instance.backerNo} mono />
              <Fact label={t("dieRoom.card.subBolster")} value={instance.subBolster} mono />
              <Fact label={t("dieRoom.card.supplier")} value={instance.supplier} />
              <Fact label={t("dieRoom.card.received")} value={instance.receivedAt ? new Date(instance.receivedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null} />
              <Fact label={t("dieRoom.card.ftr")} value={instance.ftr} />
              <Fact label={t("common.notes")} value={instance.notes} />
            </dl>
          </details>
        </Card>

        <Tabs items={tabItems} value={tab} onValueChange={(id) => onTab(id as CardTab)} label={t("dieRoom.card.title")}>
          {tab === "readings" ? <ReadingsPanel card={card} onAdd={() => setPadOpen(true)} /> : null}
          {tab === "runs" ? <RunsPanel copyId={copyId} /> : null}
          {tab === "nitriding" ? <NitridingPanel card={card} /> : null}
          {tab === "tier" ? <TierPanel card={card} /> : null}
          {tab === "maker" ? <MakerPanel card={card} /> : null}
          {tab === "files" ? <FilesPanel card={card} /> : null}
        </Tabs>

        <Can do="die.reading">
          <ReadingPad
            open={padOpen}
            onOpenChange={setPadOpen}
            dieInstanceId={instance.id}
            code={instance.code}
            lastMilli={latest}
            band={band}
          />
        </Can>
        <EditCardSheet open={editing} onOpenChange={setEditing} card={card} />
      </div>
      <PrintCard card={card} />
      <Dialog
        open={retiring}
        onOpenChange={setRetiring}
        title={t("dieRoom.card.retireTitle", { code: instance.code })}
        description={t("dieRoom.card.retireBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRetiring(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={retire.isPending} onClick={() => retire.mutate({ id: instance.id, status: "retired" })}>
              {t("dieRoom.card.retire")}
            </Button>
          </>
        }
      />
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[14px] tabular-nums break-words" : "m-0 text-[14px] break-words tabular-nums"}>
        {value ? value : "—"}
      </dd>
    </div>
  );
}
