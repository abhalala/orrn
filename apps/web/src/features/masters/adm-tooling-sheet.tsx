import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { dateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import {
  EMPTY_TOOLING,
  TOOLING_ADD_STATUSES,
  TOOLING_HAND_STATUSES,
  TOOLING_TYPES,
  toolingCreatePayload,
  toolingProblems,
  type ToolingForm,
  type ToolingStatus,
  type ToolingType,
} from "./adm-model";
import { AdmFormError, AdmSheet } from "./adm-ui";
import { useAdmAccess, useAdmInvalidate, type ToolingRow } from "./adm-use";
import { FieldTextArea } from "./masters-ui";

/**
 * Add or edit a tooling piece (die room or publishers): the mark painted on it, size, where it sits,
 * its maker and its state. A piece that waits for its receive inspection or failed it changes state
 * only through an inspection, recorded under the form.
 */
export function ToolingSheet({ open, onOpenChange, row }: { open: boolean; onOpenChange(open: boolean): void; row?: ToolingRow }) {
  const { t } = useT();
  const invalidate = useAdmInvalidate();
  const formId = `tooling-form-${useId().replace(/:/g, "")}`;
  const [form, setForm] = useState<ToolingForm>(EMPTY_TOOLING);
  const [status, setStatus] = useState<(typeof TOOLING_HAND_STATUSES)[number]>("in_store");
  const [codeError, setCodeError] = useState<string | undefined>();

  const create = useMutation(trpc.toolRoom.tooling.create.mutationOptions());
  const update = useMutation(trpc.toolRoom.tooling.update.mutationOptions());
  const busy = create.isPending || update.isPending;
  const locked = row?.status === "awaiting_inspection" || row?.status === "failed";

  useEffect(() => {
    if (!open) return;
    setForm(row ? { ...EMPTY_TOOLING, type: row.type as ToolingType, code: row.code, size: row.size ?? "", location: row.location ?? "", makerName: row.makerName ?? "", notes: row.notes ?? "" } : EMPTY_TOOLING);
    setStatus(row && (TOOLING_HAND_STATUSES as readonly string[]).includes(row.status) ? (row.status as (typeof TOOLING_HAND_STATUSES)[number]) : "in_store");
    setCodeError(undefined);
    create.reset();
    update.reset();
    // Only when the sheet opens; mutations are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const patch = (p: Partial<ToolingForm>) => setForm((f) => ({ ...f, ...p }));
  const close = () => onOpenChange(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = toolingProblems(form);
    if (found.code && !row) {
      setCodeError(t(found.code));
      return;
    }
    setCodeError(undefined);
    try {
      if (row) {
        const p = toolingCreatePayload(form);
        await update.mutateAsync({ id: row.id, size: p.size, location: p.location, makerName: p.makerName, notes: p.notes, ...(locked ? {} : { status }) });
        toast.success(t("masters.saved", { name: row.code }));
      } else {
        const p = toolingCreatePayload(form);
        await create.mutateAsync(p);
        toast.success(t("masters.added", { name: p.code }));
      }
      await invalidate.tooling();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <AdmSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("adm.masters.tooling.form.editTitle", { code: row.code }) : t("adm.masters.tooling.form.addTitle")}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("adm.masters.tooling.form.save")}
      editors={["die.card", "masters.publish"]}
    >
      <Field label={t("adm.masters.tooling.form.type")}>
        <NativeSelect value={form.type} disabled={row !== undefined} onChange={(e) => patch({ type: e.currentTarget.value as ToolingType })}>
          {TOOLING_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`adm.tooling.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("adm.masters.tooling.form.code")} hint={row ? undefined : t("adm.masters.tooling.form.codeHint")} error={codeError}>
        <TextInput value={form.code} maxLength={40} autoComplete="off" spellCheck={false} disabled={row !== undefined} aria-required="true" className="font-mono" onChangeText={(v) => {
          patch({ code: v });
          if (codeError && v.trim()) setCodeError(undefined);
        }} />
      </Field>
      <Field label={t("adm.masters.tooling.form.size")} hint={t("adm.masters.tooling.form.sizeHint")}>
        <TextInput value={form.size} maxLength={40} autoComplete="off" onChangeText={(v) => patch({ size: v })} />
      </Field>
      <Field label={t("adm.masters.tooling.form.location")}>
        <TextInput value={form.location} maxLength={60} autoComplete="off" onChangeText={(v) => patch({ location: v })} />
      </Field>
      <Field label={t("adm.masters.tooling.form.maker")}>
        <TextInput value={form.makerName} maxLength={80} autoComplete="off" onChangeText={(v) => patch({ makerName: v })} />
      </Field>
      {row ? (
        locked ? (
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("adm.masters.tooling.form.lockedHint", { status: t(`adm.toolingStatus.${row.status as ToolingStatus}`) })}</p>
        ) : (
          <Field label={t("adm.masters.tooling.form.status")}>
            <NativeSelect value={status} onChange={(e) => setStatus(e.currentTarget.value as typeof status)}>
              {TOOLING_HAND_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`adm.toolingStatus.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )
      ) : (
        <Field label={t("adm.masters.tooling.form.startStatus")} hint={t("adm.masters.tooling.form.startStatusHint")}>
          <NativeSelect value={form.status} onChange={(e) => patch({ status: e.currentTarget.value as ToolingForm["status"] })}>
            {TOOLING_ADD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`adm.toolingStatus.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field label={t("adm.masters.tooling.form.notes")}>
        <FieldTextArea value={form.notes} maxLength={200} rows={2} onChangeText={(v) => patch({ notes: v })} />
      </Field>
      {row ? <Inspections row={row} onDone={close} /> : null}
    </AdmSheet>
  );
}

/** The receive inspections of one piece, and the pass or fail buttons while it waits for one. */
function Inspections({ row, onDone }: { row: ToolingRow; onDone(): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const access = useAdmAccess();
  const invalidate = useAdmInvalidate();
  const history = useQuery(trpc.toolRoom.inspections.list.queryOptions({ subjectType: "tooling", subjectId: row.id }));
  const record = useMutation(trpc.toolRoom.inspections.record.mutationOptions());
  const [notes, setNotes] = useState("");
  const [needNotes, setNeedNotes] = useState(false);
  const waiting = row.status === "awaiting_inspection" || row.status === "failed";

  useEffect(() => {
    setNotes("");
    setNeedNotes(false);
    record.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const run = async (result: "pass" | "fail") => {
    if (record.isPending) return;
    if (result === "fail" && !notes.trim()) {
      setNeedNotes(true);
      return;
    }
    setNeedNotes(false);
    try {
      await record.mutateAsync({ subjectType: "tooling", subjectId: row.id, result, notes: notes.trim() || undefined });
      toast.success(t(result === "pass" ? "adm.masters.tooling.inspect.passed" : "adm.masters.tooling.inspect.failed", { code: row.code }));
      await Promise.all([invalidate.tooling(), history.refetch()]);
      onDone();
    } catch {
      // Shown below.
    }
  };

  const items = history.data ?? [];
  if (!waiting && items.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <span className="text-[14px] font-semibold">{t("adm.masters.tooling.inspect.title")}</span>
      {items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.slice(0, 5).map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
              <Chip tone={i.result === "pass" ? "green" : "red"}>{t(`adm.inspection.${i.result as "pass" | "fail"}`)}</Chip>
              <span className="text-muted-foreground">{dateText(fmt, i.inspectedAt)}</span>
              {i.notes ? <span className="min-w-0 break-words">{i.notes}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-muted-foreground">{t("adm.inspection.none")}</p>
      )}
      {waiting && access.canInspect ? (
        <Can do={["die.card", "die.maker", "masters.publish"]}>
          <Field label={t("adm.masters.tooling.inspect.notes")} hint={t("adm.masters.tooling.inspect.notesHint")} error={needNotes ? t("adm.masters.tooling.inspect.notesRequired") : undefined}>
            <TextInput value={notes} maxLength={200} autoComplete="off" onChangeText={(v) => { setNotes(v); if (needNotes && v.trim()) setNeedNotes(false); }} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void run("pass")} loading={record.isPending}>
              {t("adm.masters.tooling.inspect.pass")}
            </Button>
            <Button variant="secondary" onClick={() => void run("fail")} disabled={record.isPending}>
              {t("adm.masters.tooling.inspect.fail")}
            </Button>
          </div>
          <AdmFormError error={record.error} />
        </Can>
      ) : null}
    </div>
  );
}
