import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Chip } from "@orrn/ui/components/chip";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { draftFromFormat, FY_STYLES, formatFromDraft, formatProblem, MAX_DOC_PREFIX, previewNumber, sameFormat, seqFromNext, type FormatDraft } from "./adm-model";
import { AdmSheet } from "./adm-ui";
import { useAdmAccess, useAdmInvalidate, type NumberFormatRow } from "./adm-use";
import { MasterNote, MastersLoadError, RowEdit } from "./masters-ui";

/** Number formats (admin and owner): the prefix, year part and padding of each document number. */
export function NumberFormatsPanel() {
  const { t } = useT();
  const access = useAdmAccess();
  const query = useQuery(trpc.masters.numberFormats.get.queryOptions());
  const [sheet, setSheet] = useState<NumberFormatRow | null>(null);

  const columns: ResponsiveListColumn<NumberFormatRow>[] = [
    {
      key: "doc",
      header: t("adm.masters.rules.formats.columns.doc"),
      cell: (r) => (
        <RowEdit editable={access.canFormat} label={t(`adm.masters.rules.docTypes.${r.docType}`)} onEdit={() => setSheet(r)}>
          {t(`adm.masters.rules.docTypes.${r.docType}`)}
        </RowEdit>
      ),
    },
    { key: "next", header: t("adm.masters.rules.formats.columns.next"), cell: (r) => <span className="font-mono whitespace-nowrap tabular-nums">{r.next}</span> },
    {
      key: "source",
      header: t("adm.masters.rules.formats.columns.source"),
      cell: (r) => (r.custom ? <Chip tone="blue">{t("adm.masters.rules.formats.custom")}</Chip> : <span className="text-[14px] text-muted-foreground">{t("adm.masters.rules.formats.builtIn")}</span>),
    },
  ];

  if (query.isError && !query.data) return <MastersLoadError onRetry={() => void query.refetch()} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MasterNote body={access.canFormat ? t("adm.masters.rules.formats.note") : t("adm.masters.rules.formats.readOnly")} />
      <ResponsiveList
        rows={query.data ?? []}
        columns={columns}
        rowKey={(r) => r.docType}
        loading={query.isLoading}
        label={t("adm.masters.rules.tabs.formats")}
        empty={<EmptyState title={t("adm.masters.rules.formats.empty")} />}
      />
      <FormatSheet row={sheet} onOpenChange={(open) => !open && setSheet(null)} />
    </div>
  );
}

function FormatSheet({ row, onOpenChange }: { row: NumberFormatRow | null; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const invalidate = useAdmInvalidate();
  const uid = useId().replace(/:/g, "");
  const set = useMutation(trpc.masters.numberFormats.set.mutationOptions());
  const [draft, setDraft] = useState<FormatDraft>({ prefix: "", fy: "none", pad: "0" });
  const [last, setLast] = useState<NumberFormatRow | null>(null);
  const shown = row ?? last;

  useEffect(() => {
    if (!row) return;
    setLast(row);
    setDraft(draftFromFormat(row.custom ?? row.builtIn));
    set.reset();
    // Only when a different row opens; the mutation is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.docType]);

  const format = shown ? formatFromDraft(draft) : null;
  const problem = shown ? formatProblem(shown.docType, draft) : null;
  const seq = shown ? (seqFromNext(shown.next) ?? 1) : 1;
  const name = shown ? t(`adm.masters.rules.docTypes.${shown.docType}`) : "";

  const save = async (value: typeof format) => {
    if (!shown || set.isPending) return;
    try {
      await set.mutateAsync({ docType: shown.docType, format: value });
      toast.success(t("masters.saved", { name }));
      await invalidate.formats();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!format || problem) return;
    // The same text as the built-in one is stored as no format at all.
    void save(sameFormat(format, shown!.builtIn) ? null : format);
  };

  return (
    <AdmSheet
      open={row !== null}
      onOpenChange={onOpenChange}
      title={t("adm.masters.rules.formats.editTitle", { name })}
      description={t("adm.masters.rules.formats.afterSaving")}
      formId={`format-form-${uid}`}
      onSubmit={submit}
      busy={set.isPending}
      error={set.error}
      saveLabel={t("adm.masters.rules.formats.save")}
      editors="refFormat.manage"
      retire={shown?.custom ? { active: true, hint: t("adm.masters.rules.formats.resetHint"), retireLabel: t("adm.masters.rules.formats.reset"), onToggle: () => void save(null) } : undefined}
    >
      <Field label={t("adm.masters.rules.formats.prefix")} hint={t("adm.masters.rules.formats.prefixHint", { max: MAX_DOC_PREFIX })} error={problem && problem !== "adm.masters.rules.formats.problem.pad" && problem !== "adm.masters.rules.formats.problem.yearRequired" ? t(problem) : undefined}>
        <TextInput value={draft.prefix} maxLength={MAX_DOC_PREFIX} autoComplete="off" spellCheck={false} className="font-mono" onChangeText={(prefix) => setDraft((d) => ({ ...d, prefix }))} />
      </Field>
      <Field label={t("adm.masters.rules.formats.year")} hint={shown?.needsYear ? t("adm.masters.rules.formats.yearNeeded") : undefined} error={problem === "adm.masters.rules.formats.problem.yearRequired" ? t(problem) : undefined}>
        <NativeSelect value={draft.fy} onChange={(e) => setDraft((d) => ({ ...d, fy: e.currentTarget.value as FormatDraft["fy"] }))}>
          {FY_STYLES.map((s) => (
            <option key={s} value={s} disabled={s === "none" && shown?.needsYear}>
              {t(`adm.masters.rules.formats.fy.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("adm.masters.rules.formats.pad")} hint={t("adm.masters.rules.formats.padHint")} error={problem === "adm.masters.rules.formats.problem.pad" ? t(problem) : undefined}>
        <NumberInput value={draft.pad} decimal={false} onValueChange={(pad) => setDraft((d) => ({ ...d, pad }))} />
      </Field>
      <div className="flex flex-col gap-1 rounded-card border border-border bg-surface-sunken/50 px-4 py-3" aria-live="polite">
        <span className="text-[13px] text-muted-foreground">{t("adm.masters.rules.formats.preview")}</span>
        <span data-no-truncate="" className="font-mono text-[20px] font-semibold break-all">
          {format && !problem && shown ? previewNumber(format, shown.period, seq) : "-"}
        </span>
        <span className="text-[13px] text-muted-foreground">{t("adm.masters.rules.formats.previewNext")}</span>
      </div>
    </AdmSheet>
  );
}
