import { bundleTone, formatKg, formatLength, gToKg, kgPer12ft, type BundleStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { ResponsiveList, type ResponsiveListColumn, type ResponsiveListPage } from "@orrn/ui/components/responsive-list";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import type { ReactNode } from "react";

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
};

/**
 * The bundle table used by a section and by All bundles: a real table from
 * 1024px, stacked rows below (pieces and cut length share one pair there).
 * Weight in kg, cut length in the company unit, kg/12ft from weight, pieces
 * and length. Each row opens the bundle page.
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

  const columns: ResponsiveListColumn<BundleListItem>[] = [
    {
      key: "serial",
      header: t("stock.columns.serial"),
      cell: (r) => <span className="font-mono whitespace-nowrap">{r.serial}</span>,
    },
    {
      key: "status",
      header: t("stock.columns.status"),
      cell: (r) => <Chip tone={bundleTone(r.status)}>{t(`status.bundle.${r.status}`)}</Chip>,
    },
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
        const v = kgPer12ft({ weightG: r.weightG, pieces: r.quantity, lengthMm: r.lengthMm });
        return <span className="font-mono">{v === null ? "-" : formatKg(v)}</span>;
      },
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
