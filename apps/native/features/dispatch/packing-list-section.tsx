import { formatKg, formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Can } from "@/components/can";
import { useFormat } from "@/lib/use-format";
import { sharePackingListPdf, sharePackingListXlsx } from "@/lib/packing-list-export";
import { useLengthUnit } from "@/utils/length";

import { kgTotal } from "./format";
import { plTable, toPlSnapshot } from "./packing-list";

type PackingListRow = { id: string; code: string; snapshot: unknown; createdAt: Date | string | number };

/**
 * The packing list of a dispatched dispatch, mirroring the printed one: a
 * heading with the PL number and totals, then each section with its bundles
 * (Sr, bundle no, weight; item, pieces, cut length, kg/12ft and its band) and
 * a section total. Download PDF and Download Excel open the share sheet;
 * Regenerate asks the parent, which owns the save.
 */
export function PackingListSection({
  list,
  dispatchCode,
  regenerating,
  onRegenerate,
}: {
  list: PackingListRow;
  dispatchCode: string;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const { t } = useT();
  const format = useFormat();
  const length = useLengthUnit();
  const snapshot = useMemo(() => toPlSnapshot(list.snapshot), [list.snapshot]);
  const table = useMemo(() => (snapshot ? plTable(snapshot) : null), [snapshot]);
  const [sharing, setSharing] = useState<"pdf" | "xlsx" | null>(null);
  const [failed, setFailed] = useState(false);

  const share = async (kind: "pdf" | "xlsx") => {
    if (!snapshot || sharing) return;
    setSharing(kind);
    setFailed(false);
    try {
      await (kind === "pdf" ? sharePackingListPdf : sharePackingListXlsx)(snapshot, dispatchCode, length.unit);
    } catch {
      setFailed(true);
    } finally {
      setSharing(null);
    }
  };

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text accessibilityRole="header" className="font-display-bold text-xl text-ink">
          {t("packingList.title")}
        </Text>
        <Text className="font-mono-medium text-[15px] text-ink-muted">{`${t("packingList.plNo")} ${list.code}`}</Text>
        <Text className="font-sans text-[15px] text-ink-muted">{`${t("packingList.date")} ${format.day(list.createdAt as Date | number | string) ?? ""}`}</Text>
        {table ? (
          <Text className="font-sans-semibold text-base text-ink">{t("packingList.totals", { bundles: table.totals.bundles, kg: kgTotal(table.totals.weightG) })}</Text>
        ) : null}
      </View>

      {table?.sections.map((section) => (
        <View key={section.key} className="overflow-hidden rounded-card border border-hairline bg-surface">
          <View className="border-b border-hairline px-4 py-2">
            <Text className="font-display-bold text-base text-ink">{t("native.dispatch.plSection", { label: section.label, count: section.rows.length })}</Text>
          </View>
          {section.rows.map((row, index) => (
            <View
              key={row.serial}
              accessible
              accessibilityLabel={`${t("packingList.columns.sr")} ${row.sr}, ${t("packingList.columns.bundleNo")} ${row.serial}, ${row.item}, ${t("packingList.columns.weightKg")} ${formatKg(gToKg(row.weightG))}`}
              className={index > 0 ? "gap-0.5 border-t border-hairline px-4 py-2" : "gap-0.5 px-4 py-2"}
            >
              <View className="flex-row items-baseline justify-between gap-3">
                <Text className="min-w-0 flex-1 font-mono-semibold text-base text-ink">{`${row.sr}. ${row.serial}`}</Text>
                <Text className="font-mono-medium text-base text-ink">{formatKg(gToKg(row.weightG))}</Text>
              </View>
              <Text className="font-sans text-sm text-ink-muted">
                {t("native.dispatch.plFacts", {
                  pcs: row.pieces,
                  length: length.formatLength(row.lengthMm),
                  kg12: row.kg12 === null ? "-" : formatKg(row.kg12),
                })}
                {row.band === null ? "" : ` · ${t("native.dispatch.plBand", { band: formatKgTotal(row.band) })}`}
              </Text>
            </View>
          ))}
          <View className="flex-row items-baseline justify-between gap-3 border-t border-hairline bg-surface-sunken px-4 py-2">
            <Text className="font-sans-semibold text-sm text-ink">{t("packingList.groupTotal")}</Text>
            <Text className="font-mono-semibold text-sm text-ink">{`${section.pieces} · ${kgTotal(section.weightG)} kg`}</Text>
          </View>
        </View>
      ))}

      {table ? (
        <View className="flex-row items-baseline justify-between gap-3 rounded-card bg-surface-sunken px-4 py-3">
          <Text className="font-sans-semibold text-base text-ink">{t("packingList.grandTotal")}</Text>
          <Text className="font-mono-semibold text-base text-ink">{`${table.totals.pieces} · ${kgTotal(table.totals.weightG)} kg`}</Text>
        </View>
      ) : null}

      {failed ? (
        <Text accessibilityLiveRegion="polite" className="font-sans-medium text-[15px] text-destructive">
          {t("native.dispatch.shareFailed")}
        </Text>
      ) : null}
      <Button
        variant="secondary"
        label={t("packingList.downloadPdf")}
        loading={sharing === "pdf"}
        loadingLabel={t("native.dispatch.sharing")}
        disabled={!snapshot || sharing !== null}
        onPress={() => void share("pdf")}
      />
      <Button
        variant="secondary"
        label={t("packingList.downloadExcel")}
        loading={sharing === "xlsx"}
        loadingLabel={t("native.dispatch.sharing")}
        disabled={!snapshot || sharing !== null}
        onPress={() => void share("xlsx")}
      />
      <Can do="packingList.regenerate">
        <Button variant="ghost" label={t("packingList.regenerate")} loading={regenerating} onPress={onRegenerate} />
      </Can>
    </View>
  );
}
