import { bpPercent1 } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Linking, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { StatusBlock } from "@/components/ui/status-block";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { isNotFound } from "@/features/more/query-errors";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { useFormat } from "@/lib/use-format";
import { can, useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

import type { CopyStatus } from "./attention";
import { bandRangeText, copyAbilities, kgGroupedText, milliKgText, pctTenthText, statusTone, toneToChip, wallMmText } from "./copy-model";
import { statusKey } from "./copy-row";
import { IssuePanel } from "./issue-panel";
import { MakerPanel } from "./maker-panel";
import { NitridingPanel } from "./nitriding-panel";
import { ReadingPanel } from "./reading-panel";
import { canShareDrawing } from "./share-model";
import { SharePanel } from "./share-panel";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} className="min-w-[40%] flex-1 gap-0.5">
      <Text className="font-sans-medium text-[13px] text-ink-muted">{label}</Text>
      <Text className="font-mono-semibold text-[17px] text-ink">{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-4 rounded-card border border-hairline bg-surface p-5">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * The die copy card on the phone (spec E1): where the copy is, its latest weight against its own band
 * (the server's percent, colour and position), the readings keypad, nitriding, issue and return, the
 * die maker, and the engineering fields read only. Copies are changed on the card on the web.
 */
export function CopyCard({ id }: { id: string }) {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  const { data: me } = useMe();
  const [refreshing, setRefreshing] = useState(false);
  const card = useQuery({ ...trpc.dieInstance.get.queryOptions({ id }), enabled: !!id, retry: false });
  const runs = useQuery({ ...trpc.dieInstance.runs.queryOptions({ dieInstanceId: id, limit: 5 }), enabled: !!card.data });

  const refresh = () => {
    setRefreshing(true);
    void Promise.allSettled([card.refetch(), runs.refetch()]).finally(() => setRefreshing(false));
  };

  if (card.data === undefined) {
    return (
      <Screen>
        {card.isError ? (
          isNotFound(card.error) ? (
            <EmptyState title={t("dieRoom.card.notFound")} actionLabel={t("common.back")} onAction={() => (router.canGoBack() ? router.back() : router.replace("/dies"))} />
          ) : (
            <ErrorBlock error={card.error} onRetry={() => void card.refetch()} retrying={card.isFetching} />
          )
        ) : (
          <LoadingBlock />
        )}
      </Screen>
    );
  }

  const data = card.data;
  const copy = data.instance;
  const status = copy.status as CopyStatus;
  const section = data.section;
  const abilities = copyAbilities(status, (action) => can(me, action));
  const unit = t("units.kgPer12ft");
  const bandLine = data.band ? `${data.band.text} ${unit}` : null;

  const engineering: { key: string; label: string; value: string }[] = [];
  const push = (key: string, label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    engineering.push({ key, label, value: String(value) });
  };
  if (section) {
    push("alloy", t("dieRoom.card.alloy"), section.alloy);
    push("temper", t("dieRoom.card.temper"), section.temper);
    push("profile", t("dieRoom.card.profileKind"), section.profileKind ? t(`dieRoom.card.${section.profileKind}`) : null);
    if (section.wallTenthMm) push("wall", t("dieRoom.card.wall"), `${wallMmText(section.wallTenthMm)} ${t("units.mm")}`);
    push("band", t("dieRoom.copies.band"), data.band ? bandRangeText(data.band.weightMinG, data.band.weightMaxG) : null);
  }
  push("cavities", t("dieRoom.card.cavities"), data.cavityCount);
  push("bolster", t("dieRoom.card.bolster"), copy.bolster);
  push("backer", t("dieRoom.card.backer"), copy.backerNo);
  push("subBolster", t("dieRoom.card.subBolster"), copy.subBolster);
  push("rack", t("dieRoom.copies.rack"), copy.rackNo);
  push("hardness", t("dieRoom.card.hardness"), copy.hardness);
  push("supplier", t("dieRoom.card.supplier"), copy.supplier);
  push("ftr", t("dieRoom.card.ftr"), copy.ftr);
  push("trial", t("dieRoom.card.trial"), copy.trialKgPer12ftMilli != null ? `${milliKgText(copy.trialKgPer12ftMilli)} ${unit}` : null);
  push("received", t("dieRoom.card.received"), format.day(copy.receivedAt));

  async function openFile(fileId: string) {
    try {
      const signed = await queryClient.fetchQuery({ ...trpc.dieInstance.files.url.queryOptions({ id: fileId }), staleTime: 0 });
      await Linking.openURL(signed.url);
    } catch {
      feedback.error();
      announce(t("native.dies.fileFailed"));
    }
  }

  const pending = data.pendingTierChange;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: copy.code }} />
      <PageHeader
        title={copy.code}
        subtitle={section ? [section.series, section.name].filter(Boolean).join(" ") : undefined}
        right={<Chip tone={statusTone(status)} label={t(statusKey(status))} />}
      />

      <StatusBlock
        tone={toneToChip(data.tone)}
        title={t("dieRoom.copies.latestWeight")}
        meta={
          data.currentMilli != null && data.pctTenth != null
            ? `${data.position ? t(`dieRoom.position.${data.position}`) : ""} ${pctTenthText(data.pctTenth)}`.trim()
            : t("dieRoom.card.noReading")
        }
        value={data.currentMilli != null ? milliKgText(data.currentMilli) : "–"}
        unit={unit}
      />

      <View className="gap-1.5">
        {bandLine ? <Text className="font-sans text-[15px] text-ink">{`${t("dieRoom.copies.band")}: ${bandLine}`}</Text> : null}
        {copy.tierRank != null ? <Text className="font-sans text-[15px] text-ink">{t("dieRoom.copies.tier", { rank: copy.tierRank })}</Text> : null}
        {data.owner?.name ? <Text className="font-sans text-[15px] text-ink">{`${t("dieRoom.card.ownerLabel")} ${data.owner.name}`}</Text> : null}
        {copy.lifeG != null ? <Text className="font-sans text-[15px] text-ink">{t("dieRoom.card.lifeLine", { produced: kgGroupedText(data.producedG), life: kgGroupedText(copy.lifeG) })}</Text> : null}
        {data.lifeReached ? <Chip tone="amber" label={t("dieRoom.card.lifeReached")} /> : null}
        {pending ? <Chip tone="amber" label={t("dieRoom.tier.pending")} /> : null}
      </View>

      {abilities.reading ? <ReadingPanel copyId={copy.id} code={copy.code} lastMilli={data.currentMilli} bandText={data.band?.text ?? null} /> : null}

      <IssuePanel
        copyId={copy.id}
        code={copy.code}
        sectionId={copy.sectionId}
        status={status}
        canIssue={abilities.issue}
        allowed={can(me, "die.issue")}
      />

      <NitridingPanel
        copyId={copy.id}
        code={copy.code}
        status={status}
        canOut={abilities.nitridingOut}
        canBack={abilities.nitridingBack}
        rows={data.nitriding}
      />

      <MakerPanel
        copyId={copy.id}
        code={copy.code}
        status={status}
        canSend={abilities.maker && status === "available"}
        allowed={abilities.maker}
        job={data.openMakerJob}
        trialMilli={copy.trialKgPer12ftMilli}
      />

      {section && canShareDrawing((action) => can(me, action), section) ? (
        <SharePanel sectionId={section.id} section={[section.series, section.sectionCode].filter(Boolean).join(" ")} ownerCustomerId={section.ownerCustomerId} />
      ) : null}

      <Section title={t("dieRoom.card.cardTitle")}>
        {engineering.length > 0 ? (
          <View className="flex-row flex-wrap gap-x-4 gap-y-3">
            {engineering.map((f) => (
              <Fact key={f.key} label={f.label} value={f.value} />
            ))}
          </View>
        ) : null}
        {copy.notes ? <Text className="font-sans text-[15px] leading-6 text-ink">{copy.notes}</Text> : null}
        <Text className="font-sans text-sm text-ink-muted">{t("native.dies.readOnly")}</Text>
      </Section>

      <Section title={t("dieRoom.tabs.runs")}>
        {runs.data === undefined ? (
          runs.isError ? (
            <Text className="font-sans text-[15px] text-ink-muted">{t("dieRoom.runs.loadFailed")}</Text>
          ) : (
            <LoadingBlock />
          )
        ) : runs.data.length === 0 ? (
          <Text className="font-sans text-[15px] text-ink-muted">{t("dieRoom.runs.empty")}</Text>
        ) : (
          <View className="gap-2">
            {runs.data.map((r) => (
              <View key={r.pressRunId} accessible className="flex-row justify-between gap-3">
                <Text className="font-mono-semibold text-[15px] text-ink">{r.number}</Text>
                <Text className="font-mono text-[15px] text-ink-muted">
                  {`${kgGroupedText(r.outputG)} ${t("units.kg")}${r.recoveryBp != null ? `, ${bpPercent1(r.recoveryBp)}%` : ""}`}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section title={t("dieRoom.card.files")}>
        {data.files.length === 0 ? (
          <Text className="font-sans text-[15px] text-ink-muted">{t("dieRoom.files.empty")}</Text>
        ) : (
          <View className="gap-2">
            {data.files.map((f) => (
              <View key={f.id} className="flex-row items-center justify-between gap-3">
                <Text numberOfLines={2} className="min-w-0 flex-1 font-sans text-[15px] text-ink">
                  {f.filename}
                </Text>
                <Button variant="secondary" label={t("native.dies.openFile")} accessibilityHint={f.filename} onPress={() => void openFile(f.id)} />
              </View>
            ))}
          </View>
        )}
      </Section>
    </Screen>
  );
}
