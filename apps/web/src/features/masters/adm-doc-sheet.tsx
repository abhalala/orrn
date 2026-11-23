import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { openDocFile, uploadDocFile } from "./adm-doc-upload";
import { DOC_FILE_ACCEPT, DOC_KINDS, docFileKind, docPayload, docProblems, EMPTY_DOC, fileSizeText, isNoStorage, type DocForm, type DocKind } from "./adm-model";
import { AdmSheet, useAdmError } from "./adm-ui";
import { useAdmInvalidate, type DocRow } from "./adm-use";
import { FieldTextArea, MasterNote } from "./masters-ui";
import { trpc } from "@/shared/utils/trpc";
import { Can } from "@/shared/components/can";

/**
 * Add or edit a register entry (docs.manage): title, kind, version, the day it is next reviewed, notes
 * and one file (image, PDF, CDR or DWG). Retiring takes it off the register but keeps it on record.
 */
export function DocSheet({ open, onOpenChange, row }: { open: boolean; onOpenChange(open: boolean): void; row?: DocRow }) {
  const { t } = useT();
  const message = useAdmError();
  const invalidate = useAdmInvalidate();
  const formId = `doc-form-${useId().replace(/:/g, "")}`;
  const picker = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<DocForm>(EMPTY_DOC);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const create = useMutation(trpc.docs.create.mutationOptions());
  const update = useMutation(trpc.docs.update.mutationOptions());
  const busy = create.isPending || update.isPending || uploading;

  useEffect(() => {
    if (!open) return;
    setForm(row ? { title: row.title, kind: row.kind as DocKind, version: row.version ?? "", reviewOn: row.reviewOn ?? "", notes: row.notes ?? "" } : EMPTY_DOC);
    setTitleError(undefined);
    setFile(null);
    setFileProblem(null);
    create.reset();
    update.reset();
    // Only when the sheet opens; mutations are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const patch = (p: Partial<DocForm>) => setForm((f) => ({ ...f, ...p }));
  const close = () => onOpenChange(false);

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    if (!docFileKind(picked)) {
      setFile(null);
      return setFileProblem(t("adm.masters.documents.form.badType"));
    }
    setFile(picked);
    setFileProblem(null);
  };

  /** Send the picked file for a saved entry. Returns false when it did not go (the entry itself is saved). */
  const attach = async (documentId: string): Promise<boolean> => {
    if (!file) return true;
    const kind = docFileKind(file);
    if (!kind) return false;
    setUploading(true);
    try {
      await uploadDocFile({ documentId, kind, file });
      return true;
    } catch (e) {
      setFileProblem(isNoStorage(e) ? t("adm.masters.documents.errors.noStorage") : message(e));
      return false;
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = docProblems(form);
    if (found.title) {
      setTitleError(t(found.title));
      return;
    }
    setTitleError(undefined);
    const payload = docPayload(form);
    try {
      const id = row ? row.id : (await create.mutateAsync(payload)).id;
      if (row) await update.mutateAsync({ id, ...payload });
      const sent = await attach(id);
      await invalidate.docs();
      if (sent) {
        toast.success(t(row ? "masters.saved" : "masters.added", { name: payload.title }));
        close();
      } else if (!row) {
        // The entry is saved; the file did not go. Say so and let the person add it from the edit sheet.
        toast.success(t("masters.added", { name: payload.title }));
        toast.error(t("adm.masters.documents.errors.fileNotSent"));
        close();
      } else {
        toast.success(t("masters.saved", { name: payload.title }));
      }
    } catch {
      // Shown in the sheet.
    }
  };

  const toggle = async () => {
    if (!row || busy) return;
    try {
      await update.mutateAsync({ id: row.id, ...docPayload(form), active: !row.active });
      toast.success(t(row.active ? "masters.retired" : "masters.restored", { name: row.title }));
      await invalidate.docs();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  const open_ = async () => {
    if (!row) return;
    try {
      await openDocFile(row.id);
    } catch (e) {
      toast.error(message(e));
    }
  };

  return (
    <AdmSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("adm.masters.documents.form.editTitle", { name: row.title }) : t("adm.masters.documents.form.addTitle")}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("adm.masters.documents.form.save")}
      editors="docs.manage"
      retire={row ? { active: row.active, hint: t("adm.masters.documents.form.retireHint"), onToggle: () => void toggle() } : undefined}
    >
      <Field label={t("adm.masters.documents.form.title")} error={titleError}>
        <TextInput
          value={form.title}
          maxLength={120}
          autoComplete="off"
          aria-required="true"
          onChangeText={(v) => {
            patch({ title: v });
            if (titleError && v.trim()) setTitleError(undefined);
          }}
        />
      </Field>
      <Field label={t("adm.masters.documents.form.kind")}>
        <NativeSelect value={form.kind} onChange={(e) => patch({ kind: e.currentTarget.value as DocKind })}>
          {DOC_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`adm.docKinds.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t("adm.masters.documents.form.version")}>
          <TextInput value={form.version} maxLength={30} autoComplete="off" onChangeText={(v) => patch({ version: v })} />
        </Field>
        <Field label={t("adm.masters.documents.form.reviewOn")} hint={t("adm.masters.documents.form.reviewOnHint")}>
          <TextInput type="date" value={form.reviewOn} onChangeText={(v) => patch({ reviewOn: v })} />
        </Field>
      </div>
      <Field label={t("adm.masters.documents.form.notes")}>
        <FieldTextArea value={form.notes} maxLength={500} rows={3} onChangeText={(v) => patch({ notes: v })} />
      </Field>
      <Can do="docs.manage">
        <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
          <span className="text-[14px] font-semibold">{t("adm.masters.documents.form.file")}</span>
          {row?.hasFile ? (
            <p className="m-0 text-[14px] leading-6 break-words">
              {row.filename} {row.bytes ? <span className="text-muted-foreground">{t("adm.masters.documents.sizeAfter", { size: fileSizeText(row.bytes) })}</span> : null}
            </p>
          ) : (
            <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("adm.masters.documents.form.noFile")}</p>
          )}
          {file ? <p className="m-0 text-[14px] leading-6 break-words">{t("adm.masters.documents.form.picked", { name: file.name, size: fileSizeText(file.size) })}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => picker.current?.click()} disabled={busy}>
              {row?.hasFile || file ? t("adm.masters.documents.form.replaceFile") : t("adm.masters.documents.form.pickFile")}
            </Button>
            {row?.hasFile ? (
              <Button variant="ghost" onClick={() => void open_()} disabled={busy}>
                {t("adm.masters.documents.openFile")}
              </Button>
            ) : null}
          </div>
          <input ref={picker} type="file" accept={DOC_FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { pick(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
          <p className="m-0 text-[13px] text-muted-foreground">{t("adm.masters.documents.form.fileHint")}</p>
          {fileProblem ? <MasterNote tone="attention" body={fileProblem} /> : null}
        </div>
      </Can>
    </AdmSheet>
  );
}
