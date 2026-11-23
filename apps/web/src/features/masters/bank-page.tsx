import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { BankSheet } from "./adm-bank-sheet";
import { useAdmAccess, type BankRow } from "./adm-use";
import { ActiveStatus, filterByShow, MasterNote, MastersLoadError, MastersNoAccess, RowEdit, ShowFilter, type Show } from "./masters-ui";

/**
 * Bank accounts (route /masters/bank): where customers pay. Readable by the people who handle prices,
 * papers and accounts; only publishers change it. One account is the default.
 */
export function BankPage() {
  const { t } = useT();
  const access = useAdmAccess();
  const blocked = access.me !== undefined && !access.canBank;
  const list = useQuery({ ...trpc.masters.bank.list.queryOptions({ includeRetired: true }), enabled: !blocked });
  const [show, setShow] = useState<Show>("active");
  const [sheet, setSheet] = useState<{ open: boolean; row?: BankRow }>({ open: false });

  const back = { to: "/masters", label: t("masters.backToMasters") } as const;
  if (blocked) {
    return (
      <>
        <PageHeader back={back} title={t("adm.masters.bank.title")} />
        <MastersNoAccess />
      </>
    );
  }

  const rows = list.data ?? [];
  const shown = filterByShow(rows, show);

  const columns: ResponsiveListColumn<BankRow>[] = [
    {
      key: "bank",
      header: t("adm.masters.bank.columns.bank"),
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <RowEdit editable={access.canPublish} label={r.bankName} onEdit={() => setSheet({ open: true, row: r })}>
              {r.bankName}
            </RowEdit>
            {r.isDefault ? <Chip tone="green">{t("adm.masters.bank.default")}</Chip> : null}
          </span>
          {r.branch ? <span className="text-[13px] text-muted-foreground break-words">{r.branch}</span> : null}
        </span>
      ),
    },
    { key: "name", header: t("adm.masters.bank.columns.accountName"), cell: (r) => <span className="break-words">{r.accountName}</span> },
    { key: "no", header: t("adm.masters.bank.columns.accountNo"), cell: (r) => <span className="font-mono whitespace-nowrap tabular-nums">{r.accountNo}</span> },
    { key: "ifsc", header: t("adm.masters.bank.columns.ifsc"), cell: (r) => <span className="font-mono whitespace-nowrap">{r.ifsc}</span> },
    { key: "status", header: t("masters.reasons.columns.status"), cell: (r) => <ActiveStatus active={r.active} /> },
  ];

  return (
    <>
      <PageHeader
        back={back}
        title={t("adm.masters.bank.title")}
        subtitle={t("adm.masters.bank.subtitle")}
        actions={
          <Can do="masters.publish">
            <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("adm.masters.bank.add")}
            </Button>
          </Can>
        }
      />
      {!access.canPublish ? <MasterNote body={t("masters.readOnly")} /> : null}
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ShowFilter value={show} onChange={setShow} />
            </div>
          ) : null}
          <ResponsiveList
            rows={shown}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            label={t("adm.masters.bank.title")}
            empty={<EmptyState title={rows.length > 0 ? (show === "retired" ? t("masters.noRetired") : t("masters.noneInUse")) : t("adm.masters.bank.empty")} body={rows.length === 0 ? t("adm.masters.bank.emptyBody") : undefined} />}
          />
        </div>
      )}
      <BankSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} row={sheet.row} />
    </>
  );
}
