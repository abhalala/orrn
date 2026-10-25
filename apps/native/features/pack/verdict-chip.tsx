import { useT } from "@orrn/i18n";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";

import { bandText, driftChipTone, driftText, kg12Text, positionKey, positionTone, type LineVerdict } from "./line-preview";

/** The band word for a verdict ("In range", "Above range", ...) as a chip; nothing without a band. Colour comes from the server's position. */
export function VerdictChip({ verdict }: { verdict: LineVerdict | null | undefined }) {
  const { t } = useT();
  const key = verdict ? positionKey(verdict.position) : null;
  if (!verdict || !key) return null;
  return <Chip tone={positionTone(verdict.position)} label={t(key)} />;
}

/** "+4.1%" against the band start, tinted by the server's drift tone; nothing when there is no band. */
export function DriftChip({ verdict }: { verdict: LineVerdict | null | undefined }) {
  const { t } = useT();
  const tone = verdict ? driftChipTone(verdict.driftTone) : null;
  const text = verdict ? driftText(verdict.driftPercentTenths) : null;
  if (!verdict || !tone || !text) return null;
  return <Chip tone={tone} label={`${t("pack.new.drift", { percent: text })}`} />;
}

/**
 * kg per 12 ft as the server worked it out, then where it sits against the band and how far it has drifted.
 * Not a live region: the verdict is announced once, when the bundle is saved.
 */
export function LiveReadout({ verdict, loading }: { verdict: LineVerdict | null; loading: boolean }) {
  const { t } = useT();
  const kg = verdict ? kg12Text(verdict.kgPer12ftMilli) : null;
  const range = verdict?.band ? t(verdict.band.source === "copy" ? "pack.new.liveBandCopy" : "pack.new.liveBand", { band: bandText(verdict.band) }) : null;
  return (
    <View className="min-h-12 gap-2 rounded-card bg-surface-sunken px-4 py-3">
      {verdict && kg ? (
        <>
          <View className="flex-row flex-wrap items-center gap-3">
            <Text className="font-mono-semibold text-xl text-ink">{t("native.pack.readout", { value: kg })}</Text>
            <VerdictChip verdict={verdict} />
            <DriftChip verdict={verdict} />
          </View>
          {range ? <Text className="font-sans text-sm text-ink-muted">{range}</Text> : <Text className="font-sans text-sm text-ink-muted">{t("status.range.noRange")}</Text>}
        </>
      ) : (
        <Text className="font-sans text-sm text-ink-muted">{loading ? t("native.pack.liveChecking") : t("native.pack.readoutEmpty")}</Text>
      )}
    </View>
  );
}
