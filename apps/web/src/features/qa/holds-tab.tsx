import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useQaInvalidate, type QaHoldRow } from "./hooks";
import { Block, QaFormSheet } from "./ui";

/**
 * Row 29: the quality hold, separate from the sales hold. "Open holds" lists bundles the dispatch scan
 * refuses; "Hold log" is every hold with who released it and the note. Holding needs `qa.hold`,
 * releasing `qa.release`.
 */
export function HoldsTab({ log, onLog }: { log: boolean; onLog(log: boolean): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const when = useCompanyWhen();
  const list = useQuery({ ...trpc.qa.holds.list.queryOptions({ open: !log, limit: 100 }), meta: INLINE_ERROR_META });
  const [holding, setHolding] = useState(false);
  const [releasing, setReleasing] = useState<QaHoldRow | null>(null);

  const columns: ResponsiveListColumn<QaHoldRow>[] = [
    { key: "bundle", header: t("qa.holds.bundle"), cell: (r) => <span className="font-mono whitespace-nowrap font-semibold">{r.serial}</span> },
    { key: "section", header: t("qa.holds.section"), cell: (r) => r.sectionCode ?? "-" },
    { key: "weight", header: `${t("qa.holds.weight")} ${massUnit(fmt)}`, align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{kgGrouped3(fmt, r.weightG)}</span> },
    { key: "reason", header: t("qa.holds.reason"), phoneWide: true, cell: (r) => <span className="break-words">{r.reason}</span> },
    {
      key: "when",
      header: t("qa.holds.when"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5 text-[14px]">
          <span>{when(r.heldAt)}</span>
          {r.heldBy ? <span className="text-muted-foreground">{t("qa.holds.heldBy", { name: r.heldBy })}</span> : null}
        </span>
      ),
    },
    log
      ? {
          key: "released",
          header: t("qa.holds.releasedAt"),
          phoneWide: true,
          hideWhenEmpty: true,
          cell: (r) =>
            r.releasedAt ? (
              <span className="flex flex-col gap-0.5 text-[14px]">
                <span>{when(r.releasedAt)}</span>
                {r.releasedBy ? <span className="text-muted-foreground">{t("qa.holds.releasedBy", { name: r.releasedBy })}</span> : null}
                {r.releaseNote ? <span className="break-words">{r.releaseNote}</span> : null}
              </span>
            ) : null,
        }
      : {
          key: "act",
          header: t("qa.holds.release"),
          headerHidden: true,
          cell: (r) => (
            <Can do="qa.release">
              <Button variant="secondary" onClick={() => setReleasing(r)} data-testid={`qa-release-${r.serial}`}>
                {t("qa.holds.release")}
              </Button>
            </Can>
          ),
        },
  ];

  return (
    <Block
      id="qa-holds"
      title={log ? t("qa.holds.log") : t("qa.holds.open")}
      hint={t("qa.holds.holdHint")}
      actions={
        <Can do="qa.hold">
          <Button onClick={() => setHolding(true)} aria-haspopup="dialog" data-testid="qa-hold-open">
            {t("qa.holds.hold")}
          </Button>
        </Can>
      }
    >
      <SegmentedControl
        label={t("qa.holds.show")}
        value={log ? "log" : "open"}
        options={[
          { value: "open", label: t("qa.holds.open") },
          { value: "log", label: t("qa.holds.log") },
        ]}
        onChange={(v) => onLog(v === "log")}
      />
      {showsQueryError(list) ? (
        <EmptyState title={t("qa.loadFailed")} action={<Button variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>} />
      ) : (
        <ResponsiveList
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          label={log ? t("qa.holds.log") : t("qa.holds.open")}
          empty={<EmptyState title={log ? t("qa.holds.logEmpty") : t("qa.holds.empty")} />}
        />
      )}
      <HoldSheet open={holding} onOpenChange={setHolding} />
      <ReleaseSheet row={releasing} onClose={() => setReleasing(null)} />
    </Block>
  );
}

function HoldSheet({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const [serial, setSerial] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSerial("");
    setReason("");
    setTried(false);
  }, [open]);
  const hold = useMutation(
    trpc.qa.holds.hold.mutationOptions({
      onSuccess: async (r) => {
        toast.success(t("qa.holds.held", { serial: r.serial }));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  return (
    <QaFormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("qa.holds.holdTitle")}
      description={t("qa.holds.holdHint")}
      busy={hold.isPending}
      error={hold.error}
      submitLabel={t("qa.holds.hold")}
      testId="qa-hold-form"
      onSubmit={() => {
        setTried(true);
        if (!serial.trim() || !reason.trim()) return;
        hold.mutate({ serial: serial.trim().toUpperCase(), reason: reason.trim() });
      }}
    >
      <Field label={t("qa.holds.serial")} error={tried && !serial.trim() ? t("qa.required") : undefined}>
        <TextInput value={serial} maxLength={64} autoComplete="off" className="font-mono" onChange={(e) => setSerial(e.currentTarget.value)} data-testid="qa-hold-serial" />
      </Field>
      <Field label={t("qa.holds.reason")} error={tried && !reason.trim() ? t("qa.required") : undefined}>
        <FieldTextArea value={reason} maxLength={300} onChange={(e) => setReason(e.currentTarget.value)} data-testid="qa-hold-reason" />
      </Field>
    </QaFormSheet>
  );
}

function ReleaseSheet({ row, onClose }: { row: QaHoldRow | null; onClose(): void }) {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setNote("");
    setTried(false);
  }, [row?.id]);
  const release = useMutation(
    trpc.qa.holds.release.mutationOptions({
      onSuccess: async () => {
        toast.success(t("qa.holds.released", { serial: row?.serial ?? "" }));
        await invalidate();
        onClose();
      },
    }),
  );
  return (
    <QaFormSheet
      open={row !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("qa.holds.releaseTitle", { serial: row?.serial ?? "" })}
      description={row?.reason}
      busy={release.isPending}
      error={release.error}
      submitLabel={t("qa.holds.release")}
      testId="qa-release-form"
      onSubmit={() => {
        setTried(true);
        if (!row || !note.trim()) return;
        release.mutate({ bundleId: row.bundleId, note: note.trim() });
      }}
    >
      <Field label={t("qa.holds.note")} hint={t("qa.holds.noteHint")} error={tried && !note.trim() ? t("qa.holds.noteHint") : undefined}>
        <FieldTextArea value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} data-testid="qa-release-note" />
      </Field>
    </QaFormSheet>
  );
}
