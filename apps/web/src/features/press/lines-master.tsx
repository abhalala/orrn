import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { pressErrorText, useHolds } from "./hooks";
import { wholeText } from "./model";
import type { LineRow } from "./types";

type Editing = { mode: "new" } | { mode: "edit"; line: LineRow };

/** `/press/lines`: the presses of the plant. Everyone reads; masters.publish holders change them. */
export function LinesMaster() {
  const { t } = useT();
  const qc = useQueryClient();
  const holds = useHolds();
  const [showRetired, setShowRetired] = useState(false);
  const lines = useQuery({ ...trpc.press.lines.list.queryOptions({ includeRetired: showRetired }), meta: INLINE_ERROR_META });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [retiring, setRetiring] = useState<LineRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [tonnage, setTonnage] = useState("");

  const refresh = () => void qc.invalidateQueries({ queryKey: trpc.press.lines.list.queryKey() });
  const done = (message: string) => {
    toast.success(message);
    refresh();
    setEditing(null);
    setRetiring(null);
    setError(null);
  };
  const create = useMutation({ ...trpc.press.lines.create.mutationOptions(), onSuccess: () => done(t("press.linesPage.saved")), onError: (e) => setError(pressErrorText(t, e)) });
  const update = useMutation({ ...trpc.press.lines.update.mutationOptions(), onSuccess: () => done(t("press.linesPage.saved")), onError: (e) => setError(pressErrorText(t, e)) });
  const retire = useMutation({ ...trpc.press.lines.retire.mutationOptions(), onSuccess: () => done(t("press.linesPage.saved")), onError: (e) => setError(pressErrorText(t, e)) });
  const restore = useMutation({ ...trpc.press.lines.restore.mutationOptions(), onSuccess: () => done(t("press.linesPage.saved")), onError: (e) => toast.error(pressErrorText(t, e)) });

  const open = (next: Editing) => {
    setError(null);
    setCode(next.mode === "edit" ? next.line.code : "");
    setName(next.mode === "edit" ? next.line.name : "");
    setTonnage(next.mode === "edit" && next.line.tonnageT ? String(next.line.tonnageT) : "");
    setEditing(next);
  };
  const save = () => {
    setError(null);
    const tonnageT = tonnage.trim() === "" ? null : wholeText(tonnage);
    if (tonnage.trim() !== "" && tonnageT === null) return setError(t("press.linesPage.tonnageHint"));
    if (!name.trim() || (editing?.mode === "new" && !code.trim())) return setError(t("common.required"));
    if (editing?.mode === "new") create.mutate({ code: code.trim(), name: name.trim(), tonnageT });
    else if (editing?.mode === "edit") update.mutate({ id: editing.line.id, name: name.trim(), tonnageT });
  };
  const saving = create.isPending || update.isPending;

  const header = (
    <PageHeader
      title={t("press.linesPage.title")}
      subtitle={t("press.linesPage.subtitle")}
      back={{ to: "/press", label: t("press.linesPage.back") }}
      actions={
        <Can do="masters.publish">
          <Button onClick={() => open({ mode: "new" })}>
            <Plus aria-hidden="true" className="size-4" />
            {t("press.lines.add")}
          </Button>
        </Can>
      }
    />
  );

  if (showsQueryError(lines)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("press.board.loadFailed")} action={<Button variant="secondary" onClick={() => void lines.refetch()}>{t("common.retry")}</Button>} />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <label className="flex items-center gap-3 text-[15px]">
        <Checkbox checked={showRetired} onCheckedChange={(v) => setShowRetired(v === true)} />
        {t("press.linesPage.showRetired")}
      </label>
      {!lines.data ? (
        <Skeleton className="h-32 rounded-card" />
      ) : lines.data.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("press.linesPage.empty")} body={holds.publish ? t("press.linesPage.emptyBody") : undefined} />
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {lines.data.map((line) => (
            <li key={line.id} data-line={line.code} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="m-0 font-mono text-[15px] font-semibold">{line.code}</p>
                <p className="m-0 text-[15px]">{line.name}</p>
                {line.tonnageT ? <p className="m-0 text-[13px] text-muted-foreground">{line.tonnageT} {t("press.lines.tonnage")}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={line.status === "active" ? "green" : "neutral"} truncate={false}>
                  {line.status === "active" ? t("press.linesPage.active") : t("press.linesPage.retired")}
                </Chip>
                <Can do="masters.publish">
                  <Button variant="secondary" size="md" onClick={() => open({ mode: "edit", line })}>
                    {t("press.linesPage.edit")}
                  </Button>
                  {line.status === "active" ? (
                    <Button variant="ghost" size="md" onClick={() => { setError(null); setRetiring(line); }}>
                      {t("press.lines.retire")}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="md" disabled={restore.isPending} onClick={() => restore.mutate({ id: line.id })}>
                      {t("press.linesPage.restore")}
                    </Button>
                  )}
                </Can>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o && !saving) setEditing(null);
        }}
        title={editing?.mode === "new" ? t("press.lines.add") : t("press.linesPage.edit")}
        dismissible={!saving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t("press.lines.code")} hint={t("press.linesPage.codeHint")}>
            <TextInput value={code} onChange={(e) => setCode(e.currentTarget.value)} disabled={editing?.mode === "edit"} maxLength={12} autoCapitalize="characters" />
          </Field>
          <Field label={t("press.lines.name")}>
            <TextInput value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={60} />
          </Field>
          <Field label={t("press.lines.tonnage")} hint={t("press.linesPage.tonnageHint")}>
            <NumberInput value={tonnage} onValueChange={setTonnage} decimal={false} />
          </Field>
          {error ? <p role="alert" className="m-0 text-[14px] font-medium text-destructive">{error}</p> : null}
        </div>
      </Sheet>

      <Dialog
        open={retiring !== null}
        onOpenChange={(o) => {
          if (!o) setRetiring(null);
        }}
        title={retiring ? t("press.linesPage.retireConfirmTitle", { code: retiring.code }) : undefined}
        description={t("press.linesPage.retireConfirmBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRetiring(null)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={retire.isPending} onClick={() => retiring && retire.mutate({ id: retiring.id })}>
              {t("press.lines.retire")}
            </Button>
          </>
        }
      >
        {error ? <p role="alert" className="m-0 text-[14px] font-medium text-destructive">{error}</p> : null}
      </Dialog>
    </>
  );
}
