import { formatKg, gToKg, kgPer12ft, weightRange12ft } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { PressableScale } from "@/components/ui/pressable-scale";
import { bandText, driftChipTone, driftText, kg12Text, positionKey, positionTone, type ServerDriftTone, type ServerPosition } from "@/features/pack/line-preview";
import { partyNoLabel } from "@/features/pack/party";
import { formatKgBand } from "@/features/stock/format";
import { useLengthUnit } from "@/utils/length";

import { rangeStatus } from "./timeline";

const RANGE_TONE = { inRange: "green", below: "amber", above: "amber", noRange: "neutral" } as const;

/** The server's band verdict for the bundle (`bundle.getBySerial().band`, D15). */
export type BundleBandView = {
  source: "copy" | "section" | null;
  minG: number | null;
  maxG: number | null;
  position: ServerPosition;
  tone: ServerDriftTone;
  percentTenths: number | null;
};

type OrderRef = { orderNumber: string; lineNo: number; customerName: string };

/** What the server adds to a bundle page: band verdict, yard, copy, cast and the order it sits on (D15, FP-PK). */
export type BundleExtras = {
  band?: BundleBandView | null;
  range12ft?: number | null;
  location?: { code: string } | null;
  dieCopy?: { code: string } | null;
  cast?: { number: string } | null;
  order?: OrderRef | null;
  packedFor?: OrderRef | null;
};

type Fact = { key: string; label: string; value: ReactNode };

/**
 * The bundle's facts on a card: weight in kg, pieces, cut length in the
 * company unit, kg/12ft with its range chip against the die's band, the
 * billed weight range /12', the section, PO, packing session and when it was
 * packed. Section and session link to their pages.
 */
export function BundleFacts({
  bundle,
  die,
  group,
  packedAt,
  extras,
}: {
  bundle: {
    weightG: number;
    quantity: number;
    lengthMm: number;
    poNumber: string | null;
    dieId: string;
    serial?: string;
    partyNo?: string | null;
    kgPer12ftMilli?: number | null;
    weightSource?: string | null;
    weightOverrideReason?: string | null;
  };
  die: { series: string; sectionCode: string; name: string | null; weightMinG: number; weightMaxG: number } | null;
  group: { id: string; code: string } | null;
  packedAt: string;
  extras?: BundleExtras;
}) {
  const { t } = useT();
  const router = useRouter();
  const lu = useLengthUnit();
  // kg/12 ft, the band word and the drift are the server's (D15); the phone only works them out for an older server.
  const serverBand = extras?.band ?? null;
  const milli = bundle.kgPer12ftMilli ?? null;
  const perFoot = milli != null ? milli / 1000 : kgPer12ft({ weightG: bundle.weightG, pieces: bundle.quantity, lengthMm: bundle.lengthMm });
  const range = serverBand ? "noRange" : die ? rangeStatus(perFoot, die.weightMinG, die.weightMaxG) : "noRange";
  const bandKey = serverBand ? positionKey(serverBand.position) : null;
  const driftTone = serverBand ? driftChipTone(serverBand.tone) : null;
  const drift = serverBand ? driftText(serverBand.percentTenths) : null;
  const serverRange = serverBand && serverBand.minG != null && serverBand.maxG != null ? bandText({ minG: serverBand.minG, maxG: serverBand.maxG }) : null;
  const band = serverRange ?? (die ? formatKgBand(die.weightMinG, die.weightMaxG) : null);
  const party = bundle.serial ? partyNoLabel({ serial: bundle.serial, partyNo: bundle.partyNo ?? null }) : null;
  const orderText = (o: OrderRef) => `${o.orderNumber}/${o.lineNo}`;
  const section = die ? [die.series, die.sectionCode].filter(Boolean).join(" ") : null;

  const link = (label: string, mono: boolean, href: string) => (
    <PressableScale accessibilityRole="link" accessibilityLabel={label} onPress={() => router.push(href)} className="min-h-11 justify-center">
      <Text className={`${mono ? "font-mono-semibold" : "font-sans-semibold"} text-base text-ink underline`}>{label}</Text>
    </PressableScale>
  );

  const facts: Fact[] = [
    { key: "weight", label: t("bundle.facts.weight"), value: `${formatKg(gToKg(bundle.weightG))} kg` },
    { key: "pieces", label: t("bundle.facts.pieces"), value: String(bundle.quantity) },
    { key: "length", label: t("bundle.facts.cutLength"), value: lu.formatLength(bundle.lengthMm) },
    {
      key: "kg12",
      label: t("bundle.facts.kgPer12ft"),
      value:
        perFoot === null ? (
          "-"
        ) : (
          <View className="flex-row flex-wrap items-center justify-end gap-2">
            <Text className="font-mono-semibold text-base text-ink">{milli != null ? (kg12Text(milli) ?? "-") : formatKg(perFoot)}</Text>
            {bandKey ? <Chip tone={positionTone(serverBand!.position)} label={t(bandKey)} /> : null}
            {driftTone && drift ? <Chip tone={driftTone} label={t("pack.new.drift", { percent: drift })} /> : null}
            {!serverBand && range !== "noRange" ? <Chip tone={RANGE_TONE[range]} label={t(`status.range.${range}`)} /> : null}
          </View>
        ),
    },
    { key: "range", label: t("bundle.facts.weightRange"), value: extras?.range12ft != null ? formatKg(extras.range12ft, 1) : perFoot === null ? "-" : formatKg(weightRange12ft(perFoot), 1) },
    ...(band ? [{ key: "band", label: serverBand?.source === "copy" ? t("bundle.facts.copyBand") : t("bundle.facts.dieBand"), value: band }] : []),
    ...(party ? [{ key: "party", label: t("pack.partyNo"), value: party }] : []),
    { key: "section", label: t("bundle.facts.section"), value: section ? link(section, false, `/stock/${encodeURIComponent(bundle.dieId)}`) : "-" },
    ...(die?.name ? [{ key: "die", label: t("bundle.facts.die"), value: die.name }] : []),
    ...(extras?.dieCopy ? [{ key: "copy", label: t("pack.source.copy"), value: extras.dieCopy.code }] : []),
    ...(extras?.cast ? [{ key: "cast", label: t("pack.source.cast"), value: extras.cast.number }] : []),
    ...(extras ? [{ key: "location", label: t("bundle.facts.location"), value: extras.location ? extras.location.code : t("bundle.facts.noLocation") }] : []),
    ...(extras ? [{ key: "order", label: t("pack.forOrder"), value: extras.order ? `${orderText(extras.order)}, ${extras.order.customerName}` : t("pack.plantStock") }] : []),
    ...(extras?.packedFor ? [{ key: "packedFor", label: t("bundle.facts.packedFor"), value: orderText(extras.packedFor) }] : []),
    ...(bundle.weightSource === "manual" && bundle.weightOverrideReason ? [{ key: "typed", label: t("bundle.facts.typedWeight"), value: bundle.weightOverrideReason }] : []),
    ...(bundle.poNumber ? [{ key: "po", label: t("bundle.facts.po"), value: bundle.poNumber }] : []),
    ...(group ? [{ key: "session", label: t("bundle.facts.session"), value: link(group.code, true, `/pack/${encodeURIComponent(group.id)}`) }] : []),
    { key: "packed", label: t("bundle.facts.packed"), value: packedAt },
  ];

  return (
    <View className="rounded-card border border-hairline bg-surface px-4">
      {facts.map((f, i) => (
        <View
          key={f.key}
          accessible={typeof f.value === "string"}
          accessibilityLabel={typeof f.value === "string" ? `${f.label}, ${f.value}` : undefined}
          className={`min-h-12 flex-row items-center justify-between gap-4 py-2 ${i > 0 ? "border-t border-hairline" : ""}`}
        >
          <Text className="font-sans-medium text-sm text-ink-muted">{f.label}</Text>
          <View className="min-w-0 shrink items-end">
            {typeof f.value === "string" ? <Text className="text-right font-mono-semibold text-base text-ink">{f.value}</Text> : f.value}
          </View>
        </View>
      ))}
    </View>
  );
}
