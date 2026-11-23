import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { trpc } from "@/shared/utils/trpc";

import { DocSheet } from "./adm-doc-sheet";
import { openDocFile } from "./adm-doc-upload";
import { DOC_KINDS, fileSizeText } from "./adm-model";
import { useAdmError } from "./adm-ui";
import { useAdmAccess, type DocRow } from "./adm-use";
import { formatDay } from "./masters-model";
import { ActiveStatus, filterByShow, MasterNote, MastersLoadError, RowEdit, ShowFilter, type Show } from "./masters-ui";

/**
 * Documents (route /masters/documents): the plant's register of procedures, customer specs, drawings
 * and certificates, each with a version, the day it is next reviewed and one file. Any member reads it;
 * the office and managers change it. Entries due for review come first, with a plain "Review due" chip.
 */
export function DocumentsPage() {
  const { t } = useT();
  const fmt = useFmt();
  const message = useAdmError();
  const access = useAdmAccess();
  const list = useQuery(trpc.docs.list.queryOptions({ includeRetired: true }));
  const [show, setShow] = useState<Show>("active");
  const [kind, setKind] = useState<"all" | (typeof DOC_KINDS)[number]>("all");
  const [sheet, setSheet] = useState<{ open: boolean; row?: DocRow }>({ open: false });

  const today = list.data?.today ?? "";
  const rows = list.data?.items ?? [];
  const shown = filterByShow(rows, show).filter((r) => kind === "all" || r.kind === kind);
  const due = rows.filter((r) => r.reviewDue).length;

  const open = async (id: string) => {
    try {
      await openDocFile(id);
    } catch (e) {
      toast.error(message(e));
    }
  };

  const columns: ResponsiveListColumn<DocRow>[] = [
    {
      key: "title",
      header: t("adm.masters.documents.columns.title"),
      cell: (r) => (
        <RowEdit editable={access.canDocs} label={r.title} onEdit={() => setSheet({ open: true, row: r })}>
          {r.title}
        </RowEdit>
      ),
    },
    { key: "kind", header: t("adm.masters.documents.columns.kind"), cell: (r) => t(`adm.docKinds.${r.kind}`) },
    { key: "version", header: t("adm.masters.documents.columns.version"), cell: (r) => (r.version ? <span className="break-words">{r.version}</span> : <span className="text-muted-foreground">-</span>) },
    {
      key: "review",
      header: t("adm.masters.documents.columns.review"),
      cell: (r) =>
        r.reviewOn ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="whitespace-nowrap">{formatDay(fmt, r.reviewOn, today)}</span>
            {r.reviewDue ? <Chip tone="amber">{t("adm.masters.documents.reviewDue")}</Chip> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "file",
      header: t("adm.masters.documents.columns.file"),
      cell: (r) =>
        r.hasFile ? (
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <Button variant="ghost" onClick={() => void open(r.id)} aria-label={t("adm.masters.documents.openNamed", { name: r.title })}>
              {t("adm.masters.documents.openFile")}
            </Button>
            {r.bytes ? <span className="text-[13px] text-muted-foreground">{fileSizeText(r.bytes)}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("adm.masters.documents.noFile")}</span>
        ),
    },
    { key: "status", header: t("masters.reasons.columns.status"), cell: (r) => <ActiveStatus active={r.active} /> },
  ];

  return (
    <>
      <PageHeader
        back={{ to: "/masters", label: t("masters.backToMasters") }}
        title={t("adm.masters.documents.title")}
        subtitle={t("adm.masters.documents.subtitle")}
        actions={
          <Can do="docs.manage">
            <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("adm.masters.documents.add")}
            </Button>
          </Can>
        }
      />
      {!access.canDocs ? <MasterNote body={t("adm.masters.documents.readOnly")} /> : null}
      {due > 0 ? <MasterNote tone="attention" body={t("adm.masters.documents.dueNote", { count: due })} /> : null}
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ShowFilter value={show} onChange={setShow} />
              <NativeSelect density="compact" aria-label={t("adm.masters.documents.kindFilter")} value={kind} onChange={(e) => setKind(e.currentTarget.value as typeof kind)} className="sm:max-w-[220px]">
                <option value="all">{t("adm.masters.documents.allKinds")}</option>
                {DOC_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`adm.docKinds.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <ResponsiveList
            rows={shown}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            label={t("adm.masters.documents.title")}
            empty={<EmptyState title={rows.length > 0 ? (show === "retired" ? t("masters.noRetired") : t("masters.noneInUse")) : t("adm.masters.documents.empty")} body={rows.length === 0 ? t("adm.masters.documents.emptyBody") : undefined} />}
          />
        </div>
      )}
      <DocSheet open={sheet.open} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} row={sheet.row} />
    </>
  );
}
