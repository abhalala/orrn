import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Tabs } from "@orrn/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { reasonLabel } from "@/features/press/reason-label";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { ReasonSheet } from "./reason-sheet";
import { ActiveStatus, filterByShow, MasterNote, MastersLoadError, RowEdit, ShowFilter, type Show } from "./masters-ui";
import { REASON_KINDS, type ReasonKind } from "./search";
import { useMastersAccess, type ReasonRow } from "./use-masters";

/**
 * Reason codes (route /masters/reasons?kind=): the choices people pick from when a press stops, a
 * bundle is voided, a label is printed again and so on. One tab per kind; publishers add, rename
 * (English, Hindi, Gujarati wording) and retire or bring back a reason. `other` is fixed: it is
 * listed last, asks for a note and has no edit button.
 */
export function ReasonsPage({ kind, onKind }: { kind: ReasonKind; onKind(kind: ReasonKind): void }) {
  const { t, locale } = useT();
  const access = useMastersAccess();
  const list = useQuery(trpc.reasonCodes.list.queryOptions());
  const [show, setShow] = useState<Show>("active");
  const [sheet, setSheet] = useState<{ open: boolean; row?: ReasonRow }>({ open: false });

  const rows = (list.data ?? []).filter((r) => r.kind === kind);
  const shown = filterByShow(rows, show);
  const fixed = (r: ReasonRow) => r.code === "other";
  const shownAs = (r: ReasonRow) => reasonLabel(t, r.kind as ReasonKind, r.code, r.label, r, locale);
  const dash = <span className="text-muted-foreground">-</span>;

  const columns: ResponsiveListColumn<ReasonRow>[] = [
    {
      key: "label",
      header: t("masters.reasons.columns.label"),
      cell: (r) =>
        fixed(r) ? (
          <span className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="break-words">{shownAs(r)}</span>
            <Chip tone="neutral">{t("masters.reasons.fixed")}</Chip>
          </span>
        ) : (
          <RowEdit editable={access.canPublish} label={shownAs(r)} onEdit={() => setSheet({ open: true, row: r })}>
            {shownAs(r)}
          </RowEdit>
        ),
    },
    { key: "code", header: t("masters.reasons.columns.key"), cell: (r) => <span className="font-mono text-[13px]">{r.code}</span> },
    { key: "hi", header: t("masters.reasons.columns.hindi"), cell: (r) => (r.labelHi ? <span className="break-words">{r.labelHi}</span> : dash) },
    { key: "gu", header: t("masters.reasons.columns.gujarati"), cell: (r) => (r.labelGu ? <span className="break-words">{r.labelGu}</span> : dash) },
    { key: "note", header: t("masters.reasons.columns.note"), cell: (r) => (r.requiresNote ? t("masters.reasons.noteYes") : <span className="text-muted-foreground">{t("masters.reasons.noteNo")}</span>) },
    { key: "status", header: t("masters.reasons.columns.status"), cell: (r) => <ActiveStatus active={r.active} /> },
  ];

  return (
    <>
      <PageHeader
        back={{ to: "/masters", label: t("masters.backToMasters") }}
        title={t("masters.reasons.title")}
        subtitle={t("masters.reasons.subtitle")}
        actions={
          <Can do="masters.publish">
            <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("masters.reasons.add")}
            </Button>
          </Can>
        }
      />
      {!access.canPublish ? <MasterNote body={t("masters.readOnly")} /> : null}
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <Tabs
          label={t("masters.reasons.kindsLabel")}
          value={kind}
          onValueChange={(v) => onKind(v as ReasonKind)}
          items={REASON_KINDS.map((k) => ({ id: k, label: t(`reasons.kinds.${k}`) }))}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {rows.length > 0 ? <ShowFilter value={show} onChange={setShow} /> : <span />}
              <p className="m-0 text-[14px] text-muted-foreground">{t("masters.reasons.fixedHint")}</p>
            </div>
            <ResponsiveList
              rows={shown}
              columns={columns}
              rowKey={(r) => r.id}
              loading={list.isLoading}
              label={t("masters.reasons.title")}
              empty={<EmptyState title={rows.length > 0 ? (show === "retired" ? t("masters.noRetired") : t("masters.noneInUse")) : t("masters.reasons.empty")} />}
            />
          </div>
        </Tabs>
      )}
      <ReasonSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} kind={kind} row={sheet.row} />
    </>
  );
}
