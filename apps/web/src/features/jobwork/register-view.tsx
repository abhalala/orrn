import type { ProcessKind } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { dateText, kgWithUnit, rateText } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useSeesCost, type StepRow } from "./hooks";
import { processWord, REGISTER_KINDS, REGISTER_STATUSES, stepPath, type RegisterStatus } from "./model";
import { FieldSelect, StatusChip } from "./ui";

const PAGE = 50;

/** The columns of a register of steps; the money column is there only for a holder of `jobwork.cost`. */
function useColumns(): ResponsiveListColumn<StepRow>[] {
  const { t } = useT();
  const fmt = useFmt();
  const cost = useSeesCost();
  return [
    {
      key: "number",
      header: t("jw.col.number"),
      cell: (s) => (
        <UiLink to={stepPath(s.id)} className="font-mono font-semibold whitespace-nowrap">
          {s.number}
        </UiLink>
      ),
    },
    { key: "what", header: t("jw.col.process"), cell: (s) => [t(`jw.process.${processWord(s.process)}`), s.finishCode].filter(Boolean).join(" · ") },
    { key: "vendor", header: t("jw.col.vendor"), hideOnPhone: true, cell: (s) => s.vendorName ?? t("jw.col.inHouse") },
    { key: "sent", header: t("jw.col.sent"), hideOnPhone: true, cell: (s) => dateText(fmt, s.sentAt) },
    { key: "bundles", header: t("jw.col.bundles"), align: "end", cell: (s) => (s.bundlesOut > 0 ? t("jw.col.bundlesOut", { out: s.bundlesOut, total: s.bundles }) : s.bundles) },
    { key: "in", header: t("jw.col.weightIn"), align: "end", hideOnPhone: true, cell: (s) => kgWithUnit(fmt, s.inputG) },
    { key: "back", header: t("jw.col.weightBack"), align: "end", hideOnPhone: true, cell: (s) => (s.outputG > 0 ? kgWithUnit(fmt, s.outputG) : null), hideWhenEmpty: true },
    { key: "loss", header: t("jw.col.loss"), align: "end", hideOnPhone: true, cell: (s) => (s.outputG > 0 || s.lossG !== 0 ? kgWithUnit(fmt, s.lossG) : null), hideWhenEmpty: true },
    ...(cost
      ? [
          {
            key: "cost",
            header: t("jw.col.costPerKg"),
            align: "end" as const,
            hideOnPhone: true,
            hideWhenEmpty: true,
            cell: (s: StepRow) => (s.costPerKgPaise !== null && s.costPerKgPaise !== undefined ? t("jw.rate.perKg", { rate: rateText(fmt, s.costPerKgPaise) }) : null),
          },
        ]
      : []),
    { key: "status", header: t("jw.col.status"), phoneWide: true, cell: (s) => <StatusChip status={s.status} /> },
  ];
}

/**
 * The register (rows 33, 55): every step, newest first, filtered by kind and status. Server paged, 50 a page.
 * `fixedKind` pins the kind (the draw bench and fabrication lists, the in-house line) and hides the kind filter.
 */
export function RegisterView({ fixedKind, empty }: { fixedKind?: ProcessKind; empty?: React.ReactNode | null }) {
  const { t } = useT();
  const [kind, setKind] = useState<ProcessKind | "">("");
  const [status, setStatus] = useState<RegisterStatus | "">("");
  const [offset, setOffset] = useState(0);
  const columns = useColumns();
  const effectiveKind = fixedKind ?? (kind || undefined);
  const q = useQuery({
    ...trpc.process.steps.list.queryOptions({ ...(effectiveKind ? { kind: effectiveKind } : {}), ...(status ? { status } : {}), limit: PAGE, offset }),
    meta: INLINE_ERROR_META,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={t("common.filter")}>
        {fixedKind ? null : (
          <Field label={t("jw.filter.kind")}>
            <FieldSelect
              value={kind}
              onChange={(e) => {
                setKind(e.currentTarget.value as ProcessKind | "");
                setOffset(0);
              }}
              data-testid="filter-kind"
            >
              <option value="">{t("jw.filter.all")}</option>
              {REGISTER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`jw.kind.${k}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
        )}
        <Field label={t("jw.filter.status")}>
          <FieldSelect
            value={status}
            onChange={(e) => {
              setStatus(e.currentTarget.value as RegisterStatus | "");
              setOffset(0);
            }}
            data-testid="filter-status"
          >
            <option value="">{t("jw.filter.all")}</option>
            {REGISTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`jw.status.${s}`)}
              </option>
            ))}
          </FieldSelect>
        </Field>
      </div>
      {showsQueryError(q) ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("jw.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void q.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : (
        <ResponsiveList
          label={t("jw.register.label")}
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey={(s) => s.id}
          loading={q.isLoading}
          total={q.data && q.data.nextOffset === null ? offset + q.data.items.length : undefined}
          page={{ offset, limit: PAGE, onChange: setOffset }}
          empty={
            <EmptyState
              title={t("jw.register.empty")}
              body={t("jw.register.emptyBody")}
              action={empty !== undefined ? empty : (
                <Can do="jobwork.send">
                  <Button asChild>
                    <UiLink to="/jobwork/new" className="no-underline">
                      {t("jw.action.newChallan")}
                    </UiLink>
                  </Button>
                </Can>
              )}
            />
          }
        />
      )}
    </div>
  );
}
