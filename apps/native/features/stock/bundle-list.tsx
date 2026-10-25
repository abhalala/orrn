import { bundleTone, formatKg, gToKg, type BundleStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useFormat } from "@/lib/use-format";
import { useLengthUnit } from "@/utils/length";

import { pageWindow } from "./bundle-search";
import { sectionLabel } from "./sections";
import { kg12Text, positionKey, positionTone, type ServerPosition } from "../pack/line-preview";
import { partyNoLabel } from "../pack/party";

/** One `bundle.listBundles` item (dates arrive as ISO strings). */
export type BundleListItem = {
  id: string;
  serial: string;
  status: BundleStatus;
  quantity: number;
  weightG: number;
  lengthMm: number;
  poNumber: string | null;
  dieSeries: string;
  dieSectionCode: string;
  createdAt: string | number | Date;
  /** The customer's own number (FP-PK-07); shown only when it differs from the serial. */
  partyNo?: string | null;
  /** The yard it is stacked in (explorer High 14); null = none recorded. */
  locationCode?: string | null;
  /** The order line it sits on now, as printed (`SO-12/1`). */
  orderCode?: string | null;
  plantStock?: boolean;
  /** kg per 12 ft in thousandths, as the server works it out. */
  kgPer12ftMilli?: number | null;
  /** The server's band verdict (D15): the same one the bundle page and the pack session show. */
  band?: { position: ServerPosition } | null;
};

/** Bundles as tappable rows: serial and status, then kg, pieces by cut length, kg/12ft and PO. Each opens the bundle page. */
export function BundleRows({ rows, showSection = true }: { rows: readonly BundleListItem[]; showSection?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const lu = useLengthUnit();
  const fmt = useFormat();
  return (
    <View className="gap-2">
      {rows.map((r) => {
        // kg/12 ft and the band chip are the server's (D15); nothing is worked out on the phone.
        const kg12 = kg12Text(r.kgPer12ftMilli ?? null);
        const status = t(`status.bundle.${r.status}`);
        const bandKey = positionKey(r.band?.position ?? null);
        const party = partyNoLabel({ serial: r.serial, partyNo: r.partyNo ?? null });
        const facts = [
          showSection ? sectionLabel({ series: r.dieSeries, sectionCode: r.dieSectionCode }) : null,
          `${formatKg(gToKg(r.weightG))} kg`,
          `${r.quantity} × ${lu.formatLength(r.lengthMm)}`,
          kg12 === null ? null : `${kg12} ${t("units.kgPer12ft")}`,
        ].filter(Boolean);
        const more = [
          r.locationCode ? `${t("native.stock.yard")} ${r.locationCode}` : null,
          party ? `${t("pack.partyNo")} ${party}` : null,
          r.plantStock ? t("pack.plantStock") : r.orderCode ? `${t("pack.forOrder")} ${r.orderCode}` : null,
          r.poNumber ? `${t("stock.columns.po")} ${r.poNumber}` : null,
          fmt.day(r.createdAt) ? `${t("stock.columns.packed")} ${fmt.day(r.createdAt)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <PressableScale
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={[r.serial, status, bandKey ? t(bandKey) : null, ...facts, more].filter(Boolean).join(", ")}
            onPress={() => router.push(`/b/${encodeURIComponent(r.serial)}`)}
            className="min-h-14 gap-1.5 rounded-card border border-hairline bg-surface px-4 py-3"
          >
            <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Text className="font-mono-semibold text-base text-ink">{r.serial}</Text>
              <View className="flex-row flex-wrap items-center gap-2">
                {bandKey ? <Chip tone={positionTone(r.band?.position ?? null)} label={t(bandKey)} /> : null}
                <Chip tone={bundleTone(r.status)} label={status} />
              </View>
            </View>
            <Text className="font-sans text-sm text-ink">{facts.join(" · ")}</Text>
            {more ? <Text className="font-sans text-sm text-ink-muted">{more}</Text> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Previous and Next with `1-50 of 120` between them. */
export function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const { t } = useT();
  const w = pageWindow(page, total);
  if (!w.hasPrev && !w.hasNext) return null;
  return (
    <View className="gap-2">
      <Text accessibilityLiveRegion="polite" className="text-center font-sans text-sm text-ink-muted">
        {t("common.pageRange", { from: w.from, to: w.to, total })}
      </Text>
      <View className="flex-row gap-2">
        <Button className="flex-1" variant="secondary" label={t("common.previousPage")} disabled={!w.hasPrev} onPress={() => onChange(page - 1)} />
        <Button className="flex-1" variant="secondary" label={t("common.nextPage")} disabled={!w.hasNext} onPress={() => onChange(page + 1)} />
      </View>
    </View>
  );
}
