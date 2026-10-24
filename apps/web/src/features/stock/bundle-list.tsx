import { bundleTone, formatKg, formatLength, gToKg, type BundleStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { ResponsiveList, type ResponsiveListColumn, type ResponsiveListPage } from "@orrn/ui/components/responsive-list";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import type { ReactNode } from "react";

import { kg12Text, positionKey, positionTone, type ServerPosition } from "@/features/pack/line-preview";
import { partyNoLabel } from "@/features/pack/party";
import { useLengthUnit } from "@/shared/lib/length";
import { bundleDetailPath } from "@/shared/lib/paths";

import { sectionLabel } from "./sections";
import { useCompanyWhen } from "./use-company-when";

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
  /** The customer's own bundle number (FP-PK-07); shown only when it differs from the serial. */
  partyNo?: string | null;
  /** Where it is stacked: the yard code, null when no yard is recorded (legacy stock). */
  locationCode?: string | null;
  /** The order line it sits on now (`SO-12/1`); plant stock has none. */
  orderCode?: string | null;
  plantStock?: boolean;
  kgPer12ftMilli?: number | null;
  /** The server's band verdict (D15): the same one `/b/$serial` and the pack session show. */
  band?: { position: ServerPosition };
};

/**
 * The bundle table used by a section and by All bundles: a real table from
 * 1024px, stacked rows below (pieces and cut length share one pair there).
 * Weight in kg, cut length in the company unit, kg/12ft from weight, pieces
 * and length. Each row opens the bundle page. Stacked rows carry the status
 * chip beside the serial in the row title instead of a "Status" pair, so a
 * bundle takes one line less on phones and iPad portrait.
 */
export function BundleList({
  rows,
  total,
  page,
  loading,
  empty,
  label,
  showSection = true,
}: {
  rows: readonly BundleListItem[];
  total?: number;
  page: ResponsiveListPage;
  loading: boolean;
  empty: ReactNode;
  label: string;
  /** Off on a section's own page, where every row is the same section. */
  showSection?: boolean;
}) {
  const { t } = useT();
  const lu = useLengthUnit();
  const when = useCompanyWhen();
  // Same breakpoint as ResponsiveList's table.
  const wide = useMediaQuery(breakpoints.desktop);

  const chip = (r: BundleListItem) => <Chip tone={bundleTone(r.status)}>{t(`status.bundle.${r.status}`)}</Chip>;
  const columns: ResponsiveListColumn<BundleListItem>[] = [
    wide
      ? {
          key: "serial",
          header: t("stock.columns.serial"),
          cell: (r) => (
            <span className="flex flex-col">
              <span className="font-mono whitespace-nowrap" data-serial={r.serial}>{r.serial}</span>
              {partyNoLabel({ serial: r.serial, partyNo: r.partyNo ?? null }) ? (
                <span className="font-mono text-[12px] text-muted-foreground">{t("packingList.v2.partyShort", { number: r.partyNo! })}</span>
              ) : null}
            </span>
          ),
        }
      : {
          key: "serial",
          header: t("stock.columns.serial"),
          cell: (r) => (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono whitespace-nowrap" data-serial={r.serial}>{r.serial}</span>
              {chip(r)}
            </span>
          ),
        },
    ...(wide ? [{ key: "status", header: t("stock.columns.status"), cell: chip }] : []),
    ...(showSection
      ? [
          {
            key: "section",
            header: t("stock.columns.section"),
            cell: (r: BundleListItem) => sectionLabel({ series: r.dieSeries, sectionCode: r.dieSectionCode }),
          },
        ]
      : []),
    {
      key: "yard",
      header: t("stock.columns.yard"),
      cell: (r) => (r.locationCode ? <span className="font-mono whitespace-nowrap">{r.locationCode}</span> : <span className="text-muted-foreground">{t("stock.noYard")}</span>),
    },
    {
      key: "weight",
      header: t("stock.columns.weight"),
      align: "end",
      cell: (r) => <span className="font-mono">{formatKg(gToKg(r.weightG))}</span>,
    },
    ...(wide
      ? ([
          {
            key: "pieces",
            header: t("stock.columns.pieces"),
            align: "end",
            cell: (r) => <span className="font-mono">{r.quantity}</span>,
          },
          {
            key: "length",
            header: t("stock.columns.cutLength"),
            align: "end",
            cell: (r) => <span className="font-mono">{formatLength(r.lengthMm, lu.unit)}</span>,
          },
        ] satisfies ResponsiveListColumn<BundleListItem>[])
      : ([
          {
            // Stacked rows: one pair instead of two keeps a bundle to two lines of facts.
            key: "piecesLength",
            header: t("stock.columns.piecesLength"),
            cell: (r) => (
              <span className="font-mono whitespace-nowrap">
                {r.quantity} × {formatLength(r.lengthMm, lu.unit)}
              </span>
            ),
          },
        ] satisfies ResponsiveListColumn<BundleListItem>[])),
    {
      key: "kg12",
      header: t("stock.columns.kgPer12ft"),
      align: "end",
      cell: (r) => {
        // The server's figure and verdict, never worked out here (D15).
        const k = kg12Text(r.kgPer12ftMilli ?? null);
        const key = positionKey(r.band?.position ?? null);
        return (
          <span className="inline-flex items-center justify-end gap-2">
            <span className="font-mono">{k ?? "-"}</span>
            {key ? (
              <Chip tone={positionTone(r.band!.position)} data-verdict={r.band!.position}>
                {t(key)}
              </Chip>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "order",
      header: t("stock.columns.order"),
      hideOnPhone: true,
      cell: (r) =>
        r.orderCode ? (
          <span className="font-mono whitespace-nowrap">{r.orderCode}</span>
        ) : r.plantStock ? (
          <Chip tone="blue">{t("pack.plantStock")}</Chip>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "po",
      header: t("stock.columns.po"),
      hideOnPhone: true,
      cell: (r) => (r.poNumber ? <span className="font-mono">{r.poNumber}</span> : "-"),
    },
    {
      key: "packed",
      header: t("stock.columns.packed"),
      hideOnPhone: true,
      cell: (r) => <span className="whitespace-nowrap">{when(r.createdAt)}</span>,
    },
  ];

  return (
    <ResponsiveList
      rows={rows as BundleListItem[]}
      columns={columns}
      rowKey={(r) => r.id}
      rowHref={(r) => bundleDetailPath(r)}
      total={total}
      page={page}
      loading={loading}
      empty={empty}
      label={label}
    />
  );
}
