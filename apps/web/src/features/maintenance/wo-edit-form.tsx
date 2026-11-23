import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useCompanyTimeZone } from "@/features/orders/hooks";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { FieldSelect, FieldTextArea } from "./field-controls";
import { isPriority, maintErrorKey, PRIORITIES } from "./model";
import { isConflict, useInvalidateWo } from "./wo-hooks";
import { buildUpdate, conflictingKeys, editedKeys, formOf, hasChanges, rebaseForm, type WoEditForm, type WoEditSource } from "./wo-model";

const FIELD_LABEL = {
  title: "maint.workOrders.edit.what",
  priority: "maint.workOrders.edit.priority",
  assignedTo: "maint.workOrders.edit.assignedTo",
  cause: "maint.workOrders.edit.cause",
  workDone: "maint.workOrders.edit.workDone",
  labour: "maint.workOrders.edit.labour",
  startedAt: "maint.workOrders.edit.started",
  finishedAt: "maint.workOrders.edit.finished",
} as const;

type EditWo = WoEditSource & { id: string; serverSeq: number; assignedName: string | null };

/**
 * The edit card: only the fields that changed go to the server, with the `serverSeq` the draft began on (`base`).
 * When the row is refetched at a newer version the draft is kept, saving is off, and the operator chooses: keep the
 * edits on the new order (untouched fields take the new values) or drop them. The old draft never rides on the new version.
 */
export function WoEditCard({ wo }: { wo: EditWo }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWo();
  const people = useQuery(trpc.maint.workOrders.people.queryOptions());
  const zone = useCompanyTimeZone();
  // The zone the text was seeded in: a plant timezone change mid-edit must not make untouched times look changed.
  const [seedZone] = useState(zone);
  const [base, setBase] = useState<EditWo>(wo);
  const [form, setForm] = useState<WoEditForm>(() => formOf(wo, seedZone));
  const latest = useRef(wo);
  latest.current = wo;
  const [attempted, setAttempted] = useState(false);
  const set = (patch: Partial<WoEditForm>) => setForm((f) => ({ ...f, ...patch }));

  // A newer version arrived. With nothing typed yet the card just follows it; with a draft it waits for the operator.
  const stale = wo.serverSeq !== base.serverSeq;
  const untouched = editedKeys(base, form, seedZone).length === 0;
  if (stale && untouched) {
    setBase(wo);
    setForm(formOf(wo, seedZone));
  }
  const waiting = stale && !untouched;
  const clashes = waiting ? conflictingKeys(base, wo, form, seedZone) : [];
  const keepMine = () => {
    setForm((f) => rebaseForm(base, wo, f, seedZone));
    setBase(wo);
  };
  const dropMine = () => {
    setForm(formOf(wo, seedZone));
    setBase(wo);
    setAttempted(false);
  };

  const result = buildUpdate(base, form, seedZone);
  const problem = result.ok ? null : result.problem;
  const dirty = result.ok && hasChanges(result.changes);

  const save = useMutation({
    mutationFn: (changes: Extract<ReturnType<typeof buildUpdate>, { ok: true }>["changes"]) =>
      trpcClient.maint.workOrders.update.mutate({ id: base.id, serverSeq: base.serverSeq, ...changes }),
    onSuccess: async () => {
      await invalidate();
      // The saved draft is now the order: start the next edit from the refreshed row.
      setBase(latest.current);
      setForm(formOf(latest.current, seedZone));
      toast.success(t("maint.workOrders.edit.saved"));
    },
    onError: (error) => {
      toast.error(t(maintErrorKey(error)));
      if (isConflict(error)) void queryClient.invalidateQueries({ queryKey: trpc.maint.workOrders.get.queryKey({ id: base.id }) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (waiting || save.isPending || !result.ok || !hasChanges(result.changes)) return;
    save.mutate(result.changes);
  };

  const people_: { id: string; name: string }[] = [...(people.data ?? [])];
  // The person on the row is always shown, even while the list loads.
  for (const row of [base, wo]) if (row.assignedTo && !people_.some((p) => p.id === row.assignedTo)) people_.push({ id: row.assignedTo, name: row.assignedName ?? row.assignedTo });
  const nowValue = (k: keyof WoEditForm) => {
    const v = formOf(wo, seedZone)[k];
    if (k === "assignedTo") return v === "" ? t("maint.workOrders.unassigned") : (people_.find((p) => p.id === v)?.name ?? v);
    if (k === "priority") return isPriority(v) ? t(`maint.priority.${v}`) : v;
    return v === "" ? t("maint.none") : v;
  };
  const fieldLabel = (k: keyof WoEditForm) => t(FIELD_LABEL[k]);

  return (
    <section aria-labelledby="wo-edit-title" data-testid="wo-edit" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 id="wo-edit-title" className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">
        {t("maint.workOrders.edit.title")}
      </h2>
      {waiting ? (
        <div role="alert" data-testid="wo-edit-changed" className="flex flex-col gap-2 rounded-card border border-border bg-surface-sunken p-3">
          <p className="m-0 text-[15px] font-semibold">{t("maint.workOrders.edit.changedTitle")}</p>
          <p className="m-0 text-[13px] text-muted-foreground">{t("maint.workOrders.edit.changedBody")}</p>
          {clashes.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {clashes.map((k) => (
                <li key={k} className="break-words whitespace-pre-wrap">
                  {t("maint.workOrders.edit.nowOn", { field: fieldLabel(k), value: nowValue(k) })}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={keepMine}>
              {t("maint.workOrders.edit.keepMine")}
            </Button>
            <Button type="button" variant="ghost" onClick={dropMine}>
              {t("maint.workOrders.edit.dropMine")}
            </Button>
          </div>
        </div>
      ) : null}
      <form className="flex min-w-0 flex-col gap-4" onSubmit={submit}>
        <Field label={t("maint.workOrders.edit.what")} required error={problem === "title" ? t("maint.workOrders.edit.whatRequired") : undefined}>
          <TextInput value={form.title} maxLength={300} onChangeText={(v) => set({ title: v })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("maint.workOrders.edit.priority")}>
            <FieldSelect value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`maint.priority.${p}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label={t("maint.workOrders.edit.assignedTo")}>
            <FieldSelect value={form.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>
              <option value="">{t("maint.workOrders.unassigned")}</option>
              {people_.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </FieldSelect>
          </Field>
        </div>
        <Field label={t("maint.workOrders.edit.cause")}>
          <FieldTextArea value={form.cause} maxLength={2000} rows={3} onChangeText={(v) => set({ cause: v })} />
        </Field>
        <Field label={t("maint.workOrders.edit.workDone")}>
          <FieldTextArea value={form.workDone} maxLength={4000} rows={4} onChangeText={(v) => set({ workDone: v })} />
        </Field>
        <Field
          label={t("maint.workOrders.edit.labour")}
          hint={t("maint.workOrders.edit.labourHint")}
          error={problem === "labour" ? t("maint.workOrders.edit.labourBad") : undefined}
        >
          <TextInput inputMode="text" value={form.labour} onChangeText={(v) => set({ labour: v })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("maint.workOrders.edit.started")} error={problem === "startBad" ? t("maint.workOrders.edit.timeBad") : undefined}>
            <TextInput type="datetime-local" value={form.startedAt} onChangeText={(v) => set({ startedAt: v })} />
          </Field>
          <Field
            label={t("maint.workOrders.edit.finished")}
            error={problem === "finishBeforeStart" ? t("maint.workOrders.edit.finishBeforeStart") : problem === "finishBad" ? t("maint.workOrders.edit.timeBad") : undefined}
          >
            <TextInput type="datetime-local" value={form.finishedAt} onChangeText={(v) => set({ finishedAt: v })} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={waiting || !dirty || problem !== null}>
            {t("maint.workOrders.edit.save")}
          </Button>
          {attempted && !dirty && problem === null ? <span className="text-[13px] text-muted-foreground">{t("maint.workOrders.edit.nothing")}</span> : null}
        </div>
      </form>
    </section>
  );
}
