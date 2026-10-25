import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useEffect, useMemo } from "react";
import { Switch, Text, View } from "react-native";

import { Can } from "@/components/can";
import { Chip } from "@/components/ui/chip";
import { LoadingBlock } from "@/components/ui/state";

import { ChoiceList, type Choice } from "./choice-list";
import { kg12Text } from "./line-preview";
import { castRequired, copyLocked, packableCopy, sourceBlockers, withCast, withCopy, withPinOverride, withPinnedLine, type SourceBlocker, type SourceChoice } from "./source-gate";
import { useCasts, useDieCopies, useOpenLines, useOwnerCheck } from "./use-pack-server";

const NONE = "";

/** What the Source step needs from the server, and the blockers it adds up to (Next waits on them). */
export function useSourceGate(dieId: string | null, choice: SourceChoice, settings: unknown) {
  const copies = useDieCopies(dieId);
  const lines = useOpenLines(dieId);
  const casts = useCasts();
  const liveCasts = useMemo(() => (casts.data?.items ?? []).filter((c) => c.meltCount > 0), [casts.data]);
  const line = lines.data?.find((l) => l.lineId === choice.salesOrderLineId);
  const owner = useOwnerCheck({ dieId, dieInstanceId: choice.dieInstanceId, customerId: line?.customerId ?? null });
  const required = castRequired(settings, liveCasts.length);
  const blockers = sourceBlockers({ choice, castRequired: required, owner: owner.data });
  const loading = Boolean(dieId) && (copies.isPending || lines.isPending || casts.isPending || owner.isPending);
  return { copies, lines, liveCasts, line, owner, castRequired: required, blockers, loading };
}

export type SourceGate = ReturnType<typeof useSourceGate>;

/**
 * The Source step's choices (FP-PK-01/04/10, D20): the order the bundles are packed for (or Plant stock),
 * the die copy (an order line that pins a copy locks it; the office may override), the cast when the plant
 * asks for it, and the label logo. Every rule is the server's; this tells the packer early and in plain words.
 */
export function SourcePanel({ choice, onChange, gate, showErrors }: { choice: SourceChoice; onChange: (next: SourceChoice) => void; gate: SourceGate; showErrors: boolean }) {
  const { t } = useT();
  const has = (k: SourceBlocker["kind"]) => gate.blockers.find((b) => b.kind === k);
  const pinOf = (lineId: string | undefined) => (lineId ? (gate.lines.data?.find((l) => l.lineId === lineId)?.pinnedCopyId ?? null) : null);
  const pinnedCopyId = gate.line?.pinnedCopyId ?? null;
  const pinnedCode = gate.line?.pinnedCopyCode ?? null;
  const locked = copyLocked(choice, pinnedCopyId);

  // A draft restored before the pin was known, or a line picked before the copies loaded: follow the pin.
  useEffect(() => {
    if (pinnedCopyId && !choice.overridePin && choice.dieInstanceId !== pinnedCopyId) onChange(withCopy(choice, pinnedCopyId));
  }, [pinnedCopyId, choice, onChange]);

  const lineChoices: Choice[] = [
    // D20: a deliberate choice; the server writes these bundles as plant stock.
    { value: NONE, label: t("pack.source.plantStock"), detail: t("pack.source.plantStockHint") },
    ...(gate.lines.data ?? []).map((l, i) => ({
      value: l.lineId,
      label: `${l.orderNumber}/${l.lineNo}  ${l.customerName}`,
      detail: t("pack.source.lineDetail", { baki: formatKgTotal(gToKg(l.bakiG)), ordered: formatKgTotal(gToKg(l.orderedG)) }),
      tag: i === 0 ? <Chip tone="blue" label={t("pack.source.suggested")} /> : undefined,
    })),
  ];

  const copyNeedsPick = Boolean(has("copy") || has("owned") || pinnedCopyId);
  const copyChoices: Choice[] = [
    ...(copyNeedsPick ? [] : [{ value: NONE, label: t("pack.source.noCopy"), detail: t("pack.source.noCopyHint") }]),
    ...(gate.copies.data?.items ?? [])
      .filter((c) => packableCopy(c.status))
      .map((c) => ({
        value: c.id,
        disabled: locked && c.id !== pinnedCopyId,
        label: c.code,
        detail: [
          c.tierRank != null ? t("dieRoom.copies.tier", { rank: c.tierRank }) : null,
          t(`dieRoom.status.${c.status}`),
          c.latestMilli != null ? t("pack.source.latest", { kg: kg12Text(c.latestMilli) ?? "" }) : null,
        ]
          .filter(Boolean)
          .join(", "),
      })),
  ];

  const castChoices: Choice[] = [
    ...(gate.castRequired ? [] : [{ value: NONE, label: t("pack.source.noCast") }]),
    ...gate.liveCasts.map((c) => ({ value: c.id, label: c.number, detail: [c.alloy, c.grade].filter(Boolean).join(", ") || undefined })),
  ];

  const owned = gate.blockers.find((b): b is Extract<SourceBlocker, { kind: "owned" | "noCopies" }> => b.kind === "owned" || b.kind === "noCopies");

  return (
    <View className="gap-5">
      {gate.lines.isPending ? (
        <LoadingBlock />
      ) : (
        <ChoiceList
          legend={t("pack.forOrder")}
          hint={(gate.lines.data ?? []).length === 0 ? t("native.pack.noLines") : t("pack.source.forOrderHint")}
          choices={lineChoices}
          value={choice.salesOrderLineId ?? NONE}
          onChange={(v) => onChange(withPinnedLine(choice, v || undefined, pinOf(v || undefined)))}
        />
      )}

      {copyChoices.length > (copyNeedsPick ? 0 : 1) ? (
        <ChoiceList
          legend={t("pack.source.copy")}
          hint={pinnedCode ? `${t("pack.source.pinned", { code: pinnedCode })} ${t("pack.source.copyHint")}` : t("pack.source.copyHint")}
          error={showErrors && has("copy") ? t("pack.source.copyRequired") : null}
          choices={copyChoices}
          value={choice.dieInstanceId ?? NONE}
          onChange={(v) => onChange(withCopy(choice, v || undefined))}
        />
      ) : null}

      {pinnedCopyId ? (
        <Can do="order.manage">
          <View className="min-h-11 flex-row items-center justify-between gap-3">
            <Text className="min-w-0 flex-1 font-sans-semibold text-[15px] text-ink">{t("pack.source.pinnedOverride")}</Text>
            <Switch accessibilityLabel={t("pack.source.pinnedOverride")} value={Boolean(choice.overridePin)} onValueChange={(on) => onChange(withPinOverride(choice, on, pinnedCopyId))} />
          </View>
        </Can>
      ) : null}

      {castChoices.length > (gate.castRequired ? 0 : 1) ? (
        <ChoiceList
          legend={t("pack.source.cast")}
          hint={gate.castRequired ? t("pack.source.castRequiredHint") : t("pack.source.castHint")}
          error={showErrors && has("cast") ? t("pack.source.castRequired") : null}
          choices={castChoices}
          value={choice.castId ?? NONE}
          onChange={(v) => onChange(withCast(choice, v || undefined))}
        />
      ) : null}

      {owned ? (
        <View accessibilityLiveRegion="polite" className="rounded-card bg-tone-amber-tint px-4 py-3">
          <Text className="font-sans-medium text-[15px] leading-6 text-tone-amber-ink">
            {owned.kind === "noCopies" ? t("pack.source.noCopies") : owned.ownerName ? t("pack.dieOwned", { name: owned.ownerName }) : t("pack.dieOwnedOther")}
            {owned.kind === "owned" ? ` ${t("pack.source.ownedHint")}` : ""}
          </Text>
        </View>
      ) : null}

      <View className="gap-1">
        <View className="min-h-11 flex-row items-center justify-between gap-3">
          <Text className="min-w-0 flex-1 font-sans-semibold text-[15px] text-ink">{t("pack.showLogo")}</Text>
          <Switch accessibilityLabel={t("pack.showLogo")} value={choice.showLogo} onValueChange={(showLogo) => onChange({ ...choice, showLogo })} />
        </View>
        <Text className="font-sans text-sm text-ink-muted">{t("pack.source.logoHint")}</Text>
      </View>
    </View>
  );
}
