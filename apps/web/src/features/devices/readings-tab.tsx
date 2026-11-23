import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import type { DeviceReading } from "./hooks";
import { READING_KINDS, type ReadingKind } from "./search";
import { Block, SimBadge } from "./ui";

const PAGE = 50;

/** What the devices sent, newest first. Weights come through the plant's unit; a clock that was off is said. */
export function ReadingsTab({ kind, onKind }: { kind: ReadingKind | undefined; onKind(kind: ReadingKind | undefined): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const when = useCompanyWhen();
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [kind]);
  const q = useQuery({ ...trpc.devices.readings.list.queryOptions({ kind, limit: PAGE, cursor: offset }), placeholderData: keepPreviousData, meta: INLINE_ERROR_META });
  const unit = massUnit(fmt);
  const g = (v: number | null) => (v === null ? "-" : kgGrouped3(fmt, v));

  const columns: ResponsiveListColumn<DeviceReading>[] = [
    {
      key: "when",
      header: t("dev3.readings.cols.when"),
      cell: (r) => (
        <span className="flex flex-col gap-1 text-[14px]">
          <span className="flex flex-wrap items-center gap-2">
            <span>{when(r.sampledAt)}</span>
            {r.simulated ? <SimBadge /> : null}
          </span>
          {r.timeUnconfirmed ? (
            <span data-testid="dev3-unconfirmed" title={t("dev3.readings.unconfirmedHint")} className="text-[13px] text-tone-amber-ink">
              {t("dev3.readings.unconfirmed")}
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "kind", header: t("dev3.readings.cols.kind"), cell: (r) => (r.kind === "weighbridge" ? t("dev3.kind.weighbridge") : t(`dev3.lab.kind.${r.kind as "dimension" | "mechanical"}`)) },
    { key: "ticket", header: t("dev3.readings.cols.ticket"), hideOnPhone: true, cell: (r) => (r.ticketNo ? <span className="font-mono whitespace-nowrap">{r.ticketNo}</span> : null) },
    { key: "vehicle", header: t("dev3.readings.cols.vehicle"), hideOnPhone: true, cell: (r) => (r.vehicleNo ? <span className="font-mono whitespace-nowrap">{r.vehicleNo}</span> : null) },
    { key: "gross", header: `${t("dev3.readings.cols.gross")} ${unit}`, align: "end", hideOnPhone: true, cell: (r) => (r.kind === "weighbridge" ? <span className="font-mono tabular-nums">{g(r.grossG)}</span> : null) },
    { key: "tare", header: `${t("dev3.readings.cols.tare")} ${unit}`, align: "end", hideOnPhone: true, cell: (r) => (r.kind === "weighbridge" ? <span className="font-mono tabular-nums">{g(r.tareG)}</span> : null) },
    { key: "net", header: `${t("dev3.readings.cols.net")} ${unit}`, align: "end", cell: (r) => (r.kind === "weighbridge" ? <span className="font-mono font-semibold tabular-nums">{g(r.netG)}</span> : null) },
    { key: "sample", header: t("dev3.readings.cols.sample"), cell: (r) => (r.sampleCode ? <span className="font-mono whitespace-nowrap">{r.sampleCode}</span> : null) },
    { key: "source", header: t("dev3.readings.cols.source"), hideOnPhone: true, cell: (r) => t(`dev3.readings.source.${r.source}`) },
  ];

  return (
    <Block id="dev3-readings" title={t("dev3.readings.title")} hint={t("dev3.readings.hint")}>
      <SegmentedControl
        label={t("dev3.readings.cols.kind")}
        value={kind ?? "all"}
        options={[{ value: "all", label: t("dev3.readings.all") }, ...READING_KINDS.map((k) => ({ value: k, label: k === "weighbridge" ? t("dev3.kind.weighbridge") : t(`dev3.lab.kind.${k}`) }))]}
        onChange={(v) => onKind(v === "all" ? undefined : (v as ReadingKind))}
      />
      {showsQueryError(q) ? (
        <EmptyState title={t("dev3.loadFailed")} action={<Button variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>} />
      ) : (
        <ResponsiveList
          rows={q.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          label={t("dev3.readings.title")}
          empty={<EmptyState title={t("dev3.readings.empty")} />}
          page={q.data && (offset > 0 || q.data.nextCursor !== null) ? { offset, limit: PAGE, onChange: setOffset } : undefined}
        />
      )}
    </Block>
  );
}
