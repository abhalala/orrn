import type { SpectroVerdict } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { StatusBlock } from "@/components/ui/status-block";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import { CloseSheet } from "./close-sheet";
import { CAST_TONE, closeBlock, latestVerdict, lockedMeltTone, MELT_TONE, tailChip, verdictTone, type CastStatus, type MeltStatus } from "./foundry-model";
import type { MeltRow } from "./types";
import { Figure, kgOf, Note, Section } from "./ui";

const CAST_STATUS_KEY: Record<CastStatus, MessageKey> = {
  open: "foundry.casts.status.open",
  closing: "foundry.casts.status.closing",
  closed: "foundry.casts.status.closed",
  cancelled: "foundry.casts.status.cancelled",
};
const MELT_STATUS_KEY: Record<MeltStatus, MessageKey> = {
  draft: "foundry.melt.status.draft",
  locked: "foundry.melt.status.locked",
  cancelled: "foundry.melt.status.cancelled",
  corrected: "foundry.melt.status.corrected",
};
const VERDICT_KEY: Record<SpectroVerdict, MessageKey> = {
  pass: "foundry.spectro.verdict.pass",
  fail: "foundry.spectro.verdict.fail",
  incomplete: "foundry.spectro.verdict.incomplete",
};

/**
 * One cast on the phone: number and alloy large, status chip, the tail chip (the server's close-out), the
 * billets it made, used and holds, and its melts. The foundry floor starts a melt; Close cast is for the
 * people who hold `cast.close` and sits behind <Can>. Every figure is the server's.
 */
export function CastDetail({ id }: { id: string }) {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  const [closing, setClosing] = useState(false);
  const query = useQuery({ ...trpc.foundry.casts.get.queryOptions({ id }), refetchInterval: 30_000 });
  const data = query.data;

  if (query.isPending) return <LoadingBlock />;
  if (!data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />;

  const c = data.cast;
  const co = data.closeout;
  const status = c.status as CastStatus;
  const chip = tailChip(co);
  const chipLabel =
    chip.kind === "balanced"
      ? t("foundry.cast.tailChip.balanced")
      : chip.kind === "empty"
        ? t("foundry.cast.tailChip.empty")
        : chip.kind === "short"
          ? t("foundry.cast.tailChip.short", { kg: kgOf(co.shortG) })
          : t("foundry.cast.tailChip.tail", { kg: kgOf(Math.abs(co.tailG)) });
  const block = closeBlock(c.status, co);
  const openMelt = (meltId: string) => router.push({ pathname: "/cast/melt/[meltId]", params: { meltId, castId: c.id } } as never);

  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text accessibilityRole="header" className="font-display-extrabold text-4xl text-ink">
          {t("foundry.cast.heading", { number: c.number })}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Chip tone="neutral" label={t("foundry.cast.alloyIs", { alloy: c.alloy })} />
          <Chip tone={CAST_TONE[status] ?? "neutral"} label={t(CAST_STATUS_KEY[status] ?? CAST_STATUS_KEY.open)} />
          <Chip tone={chip.tone} label={chipLabel} />
          {co.draftMelts > 0 ? <Chip tone="amber" label={t("foundry.casts.drafts", { count: co.draftMelts })} /> : null}
        </View>
      </View>

      {c.status === "closing" ? <Note tone="amber">{t("foundry.cast.approval.waiting")}</Note> : null}
      {c.status === "open" && data.approval?.status === "rejected" ? (
        <Note tone="red">{data.approval.note ? `${t("foundry.cast.approval.rejected")} ${data.approval.note}` : t("foundry.cast.approval.rejected")}</Note>
      ) : null}

      <StatusBlock tone="blue" title={t("foundry.cast.panel.onHand")} value={kgOf(co.billetsOnHandG)} unit={t("units.kg")} />
      <Section title={t("foundry.cast.panel.title")}>
        <View className="flex-row flex-wrap gap-4">
          <Figure label={t("foundry.cast.panel.produced")} value={`${kgOf(co.producedG)} ${t("units.kg")}`} />
          <Figure label={t("foundry.cast.panel.pressed")} value={`${kgOf(co.creditedG)} ${t("units.kg")}`} />
          <Figure label={t("foundry.cast.panel.tail")} value={`${co.tailG < 0 ? "-" : ""}${kgOf(Math.abs(co.tailG))} ${t("units.kg")}`} strong />
          <Figure label={t("foundry.cast.panel.metalIn")} value={`${kgOf(co.inputG)} ${t("units.kg")}`} />
        </View>
      </Section>

      <View className="gap-2">
        <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
          {t("foundry.cast.melts.title")}
        </Text>
        {data.melts.length === 0 ? <EmptyState title={t("foundry.cast.melts.none")} /> : null}
        {data.melts.map((m) => {
          const ms = m.status as MeltStatus;
          const verdict = latestVerdict(m.spectro);
          const tone = ms === "locked" ? lockedMeltTone({ verdict, lossBp: m.lossBp, warnings: m.warnings ?? [] }) : (MELT_TONE[ms] ?? "neutral");
          const clock = m.chargingStartAt && m.castingEndAt ? `${format.time(m.chargingStartAt) ?? ""} - ${format.time(m.castingEndAt) ?? ""}` : undefined;
          return (
            <ListRow
              key={m.id}
              title={t("foundry.melt.number", { n: m.seq })}
              subtitle={ms === "draft" ? clock : [clock, t("foundry.cast.trace.inLogs", { inKg: kgOf(m.inputG), logs: kgOf(m.logsG) })].filter(Boolean).join(" · ")}
              trailing={
                <View className="items-end gap-1">
                  <Chip tone={tone} label={t(MELT_STATUS_KEY[ms] ?? MELT_STATUS_KEY.draft)} />
                  {ms !== "draft" ? <Chip tone={verdictTone(verdict)} label={verdict ? t(VERDICT_KEY[verdict]) : t("foundry.spectro.none")} /> : null}
                </View>
              }
              onPress={() => openMelt(m.id)}
            />
          );
        })}
      </View>

      {c.status === "open" ? (
        <Can do="melt.enter">
          <Button size="lg" label={t("foundry.melt.new")} onPress={() => openMelt("new")} />
        </Can>
      ) : null}

      <Can do="cast.close">
        {c.status === "open" && block === "draft_melts" ? <Note tone="amber">{t("foundry.cast.close.blockedDraft")}</Note> : null}
        {c.status === "open" && block === null ? <Button variant="secondary" size="lg" label={t("foundry.cast.close.button")} onPress={() => setClosing(true)} /> : null}
        <CloseSheet visible={closing} onClose={() => setClosing(false)} cast={data} />
      </Can>
    </View>
  );
}
