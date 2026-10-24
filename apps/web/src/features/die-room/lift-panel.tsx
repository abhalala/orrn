import { useT } from "@orrn/i18n";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";

import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { BandPositionChip, PercentChip } from "./drift-chips";
import {
  bandRangeText,
  kgPerMetreText,
  milliKgText,
  parseRank,
  wallMmText,
} from "./die-room-model";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

/** `/dies/copies/$copyId/lift`: ask for the copy to move to another band. A manager decides; the code never changes. */
export function LiftPage({ copyId }: { copyId: string }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [target, setTarget] = useState("");
  const [rank, setRank] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const card = useQuery({ ...trpc.dieInstance.get.queryOptions({ id: copyId }), retry: false, meta: INLINE_ERROR_META });
  const sectionId = card.data?.instance.sectionId;
  const bands = useQuery({
    ...trpc.die.bands.list.queryOptions({ sectionId: sectionId ?? "" }),
    enabled: Boolean(sectionId),
    meta: INLINE_ERROR_META,
  });
  const drift = useQuery({
    ...trpc.dieInstance.drift.queryOptions({ sectionId: sectionId ?? "" }),
    enabled: Boolean(sectionId),
    meta: INLINE_ERROR_META,
  });

  const propose = useMutation({
    ...trpc.dieInstance.proposeTier.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.tier.sent"));
      setError(null);
    },
    onError: (e) => setError(refusal(e)),
  });

  const back = { to: `/dies/copies/${copyId}`, label: t("dieRoom.lift.backToCard") };

  if (card.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-10 w-1/2 max-w-[320px]" />
        <Skeleton className="h-[240px] rounded-card" />
      </div>
    );
  }
  if (showsQueryError(card) || !card.data) {
    return (
      <>
        <PageHeader back={{ to: "/dies", label: t("nav.dies") }} title={t("dieRoom.lift.title")} />
        <EmptyState
          title={t("dieRoom.card.notFound")}
          action={
            <Button asChild variant="secondary">
              <Link to="/dies">{t("dies.detail.backToList")}</Link>
            </Button>
          }
        />
      </>
    );
  }

  const { instance, band, pendingTierChange: pending } = card.data;
  const mine = drift.data?.items.find((i) => i.dieInstanceId === instance.id);
  const targets = [
    ...(bands.data
      ? [
          ...(band?.id !== null ? [{ ...bands.data.primary, id: "primary" as string | null }] : []),
          ...bands.data.bands.filter((b) => b.active && b.id !== band?.id).map((b) => ({ ...b, id: b.id as string | null })),
        ]
      : []),
  ].map((b) => ({
    value: b.id ?? "primary",
    label: `${wallMmText(b.wallTenthMm)} ${t("units.mm")} · ${bandRangeText(b.weightMinG, b.weightMaxG)} ${t("units.kgPer12ft")}`,
  }));
  const chosen = target || targets[0]?.value || "";
  const rankText = rank ?? (instance.tierRank == null ? "" : String(instance.tierRank));
  const bandNameOf = (id: string | null) => {
    if (id == null && bands.data) return bandRangeText(bands.data.primary.weightMinG, bands.data.primary.weightMaxG);
    const b = bands.data?.bands.find((x) => x.id === id);
    return b ? bandRangeText(b.weightMinG, b.weightMaxG) : "";
  };

  const submit = () => {
    if (!chosen) return;
    if (!reason.trim()) return setError(t("dieRoom.tier.reasonRequired"));
    const r = parseRank(rankText);
    if (rankText.trim() !== "" && r === null) return setError(t("dieRoom.tier.rankInvalid"));
    setError(null);
    propose.mutate({
      dieInstanceId: instance.id,
      lift: true,
      toBandId: chosen === "primary" ? null : chosen,
      ...(r !== null && r !== instance.tierRank ? { rank: r } : {}),
      reason: reason.trim(),
    });
  };

  return (
    <>
      <PageHeader back={back} title={t("dieRoom.lift.title")} subtitle={instance.code} />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="min-w-0">
          <p className="m-0 text-[13px] font-semibold text-muted-foreground">{t("dieRoom.lift.codeStays")}</p>
          <p data-no-truncate="" className="m-0 font-mono text-[40px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
            {instance.code}
          </p>
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">
            {instance.tierRank == null ? t("dieRoom.copies.untiered") : t("dieRoom.copies.tier", { rank: instance.tierRank })}
          </p>
          <dl className="m-0 grid grid-cols-1 gap-3">
            <div>
              <dt className="text-[12px] font-medium text-muted-foreground">{t("dieRoom.lift.currentBand")}</dt>
              <dd className="m-0 font-mono text-[15px] font-semibold tabular-nums">
                {band ? `${wallMmText(band.wallTenthMm)} ${t("units.mm")} · ${bandRangeText(band.weightMinG, band.weightMaxG)} ${t("units.kgPer12ft")}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] font-medium text-muted-foreground">{t("dieRoom.lift.reading")}</dt>
              <dd className="m-0 font-mono text-[15px] tabular-nums">
                {card.data.currentMilli == null
                  ? t("dieRoom.card.noReading")
                  : `${milliKgText(card.data.currentMilli)} ${t("units.kgPer12ft")} · ${kgPerMetreText(card.data.kgPerMetre)} ${t("units.kgPerMetre")}`}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <PercentChip tone={card.data.tone} pctTenth={card.data.pctTenth} />
            <BandPositionChip position={card.data.position} />
          </div>
          {mine && mine.offBandMilli ? (
            <p className="m-0 text-[15px] font-semibold tabular-nums" data-testid="off-band">
              {mine.offBandMilli > 0
                ? t("dieRoom.lift.aboveBy", { g: mine.offBandMilli.toLocaleString("en-IN") })
                : t("dieRoom.lift.belowBy", { g: Math.abs(mine.offBandMilli).toLocaleString("en-IN") })}
            </p>
          ) : null}
        </Card>

        <Card className="min-w-0">
          <CardTitle>{t("dieRoom.lift.proposeTitle")}</CardTitle>
          {pending ? (
            <div role="status" className="flex flex-col gap-2 rounded-card border border-border bg-tone-amber-tint px-4 py-3 text-tone-amber-ink" data-testid="lift-pending">
              <p className="m-0 text-[15px] font-semibold">{t("dieRoom.tier.waitingManager")}</p>
              <p className="m-0 text-[14px] leading-6">
                {pending.isLift
                  ? t("dieRoom.tier.pendingLift", { band: bandNameOf(pending.toBandId) })
                  : t("dieRoom.tier.pendingRank", { rank: pending.toRank })}
              </p>
              <p className="m-0 text-[13px] leading-5">{t("dieRoom.lift.managerDecides")}</p>
              <Link to="/approvals" className="text-[14px] font-semibold text-tone-amber-ink">
                {t("dieRoom.tier.openApprovals")}
              </Link>
            </div>
          ) : targets.length === 0 ? (
            <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.lift.noOtherBand")}</p>
          ) : (
            <Can
              do="die.rerank"
              fallback={<Badge tone="neutral">{t("dieRoom.lift.dieRoomOnly")}</Badge>}
            >
              <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.lift.oldBandKeeps")}</p>
              <Field label={t("dieRoom.lift.targetBand")}>
                <Select value={chosen} onValueChange={setTarget} options={targets} />
              </Field>
              <Field label={t("dieRoom.lift.rankAfter")} hint={t("common.optional")}>
                <NumberInput value={rankText} onValueChange={setRank} decimal={false} />
              </Field>
              <Field label={t("common.reason")}>
                <FieldTextArea value={reason} onChangeText={setReason} rows={3} maxLength={500} />
              </Field>
              {error ? (
                <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
                  {error}
                </p>
              ) : null}
              <FormActions sticky className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+12px)]">
                <Button onClick={submit} loading={propose.isPending}>
                  {t("dieRoom.lift.submit")}
                </Button>
              </FormActions>
            </Can>
          )}
        </Card>
      </div>
    </>
  );
}
