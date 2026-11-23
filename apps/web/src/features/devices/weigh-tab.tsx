import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import type { WeighMismatch } from "./hooks";
import { weighSubjectPath } from "./model";
import { Block } from "./ui";

const PAGE = 50;

/** Scrap lots and loads whose weight on record is not the bridge ticket's, beyond the allowed difference. */
export function WeighTab() {
  const { t } = useT();
  const fmt = useFmt();
  const when = useCompanyWhen();
  const [offset, setOffset] = useState(0);
  const q = useQuery({ ...trpc.devices.weigh.mismatches.queryOptions({ limit: PAGE, cursor: offset }), placeholderData: keepPreviousData, meta: INLINE_ERROR_META });
  const unit = massUnit(fmt);
  const g = (v: number | null) => (v === null ? "-" : kgGrouped3(fmt, v));
  const columns: ResponsiveListColumn<WeighMismatch>[] = [
    {
      key: "number",
      header: t("dev3.weigh.cols.number"),
      cell: (r) =>
        r.subjectId ? (
          <UiLink to={weighSubjectPath(r.subjectType, r.subjectId)} className="font-mono font-semibold whitespace-nowrap underline underline-offset-4" data-testid={`dev3-weigh-link-${r.number}`}>
            {r.number}
          </UiLink>
        ) : (
          <span className="font-mono font-semibold">{r.number}</span>
        ),
    },
    { key: "kind", header: t("dev3.weigh.cols.kind"), cell: (r) => (r.subjectType === "purchase_lot" ? t("dev3.weigh.lot") : t("dev3.weigh.dispatch")) },
    { key: "bridge", header: `${t("dev3.weigh.cols.bridge")} ${unit}`, align: "end", cell: (r) => <span className="font-mono tabular-nums">{g(r.bridgeG)}</span> },
    {
      key: "record",
      header: `${t("dev3.weigh.cols.record")} ${unit}`,
      align: "end",
      cell: (r) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-mono tabular-nums">{g(r.currentG)}</span>
          {r.typedG !== null ? <span className="text-[12px] text-muted-foreground">{t("dev3.weigh.typed")}</span> : null}
        </span>
      ),
    },
    { key: "reason", header: t("dev3.weigh.cols.reason"), hideOnPhone: true, cell: (r) => <span className="break-words">{r.reason ?? ""}</span> },
    { key: "when", header: t("dev3.weigh.cols.when"), cell: (r) => <span className="text-[14px]">{when(r.createdAt)}</span> },
  ];
  return (
    <Block id="dev3-weigh" title={t("dev3.weigh.title")} hint={t("dev3.weigh.hint")}>
      {showsQueryError(q) ? (
        <EmptyState title={t("dev3.loadFailed")} action={<Button variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>} />
      ) : (
        <ResponsiveList
          rows={q.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          label={t("dev3.weigh.title")}
          empty={<EmptyState title={t("dev3.weigh.empty")} />}
          page={q.data && (offset > 0 || q.data.nextCursor !== null) ? { offset, limit: PAGE, onChange: setOffset } : undefined}
        />
      )}
    </Block>
  );
}
