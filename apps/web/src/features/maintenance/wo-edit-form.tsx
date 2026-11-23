import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/shared/utils/trpc";

import { maintErrorKey, PRIORITIES } from "./model";
import { isConflict, useInvalidateWo } from "./wo-hooks";
import { buildUpdate, formOf, hasChanges, type WoEditForm, type WoEditSource } from "./wo-model";

/** The edit card: only the fields that changed go to the server, with the `serverSeq` the screen was opened at. */
export function WoEditCard({ wo }: { wo: WoEditSource & { id: string; serverSeq: number; assignedName: string | null } }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWo();
  const people = useQuery(trpc.maint.workOrders.people.queryOptions());
  const [form, setForm] = useState<WoEditForm>(() => formOf(wo));
  const [attempted, setAttempted] = useState(false);
  const set = (patch: Partial<WoEditForm>) => setForm((f) => ({ ...f, ...patch }));

  const result = buildUpdate(wo, form);
  const problem = result.ok ? null : result.problem;
  const dirty = result.ok && hasChanges(result.changes);

  const save = useMutation({
    mutationFn: (changes: Extract<ReturnType<typeof buildUpdate>, { ok: true }>["changes"]) =>
      trpcClient.maint.workOrders.update.mutate({ id: wo.id, serverSeq: wo.serverSeq, ...changes }),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("maint.workOrders.edit.saved"));
    },
    onError: (error) => {
      toast.error(t(maintErrorKey(error)));
      if (isConflict(error)) void queryClient.invalidateQueries({ queryKey: trpc.maint.workOrders.get.queryKey({ id: wo.id }) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (save.isPending || !result.ok || !hasChanges(result.changes)) return;
    save.mutate(result.changes);
  };

  const people_: { id: string; name: string }[] = [...(people.data ?? [])];
  // The person on the row is always shown, even while the list loads.
  if (wo.assignedTo && !people_.some((p) => p.id === wo.assignedTo)) people_.push({ id: wo.assignedTo, name: wo.assignedName ?? wo.assignedTo });

  return (
    <section aria-labelledby="wo-edit-title" data-testid="wo-edit" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 id="wo-edit-title" className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">
        {t("maint.workOrders.edit.title")}
      </h2>
      <form className="flex min-w-0 flex-col gap-4" onSubmit={submit}>
        <Field label={t("maint.workOrders.edit.what")} required error={problem === "title" ? t("maint.workOrders.edit.whatRequired") : undefined}>
          <TextInput value={form.title} maxLength={300} onChangeText={(v) => set({ title: v })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("maint.workOrders.edit.priority")}>
            <NativeSelect value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`maint.priority.${p}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("maint.workOrders.edit.assignedTo")}>
            <NativeSelect value={form.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>
              <option value="">{t("maint.workOrders.unassigned")}</option>
              {people_.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label={t("maint.workOrders.edit.cause")}>
          <TextArea value={form.cause} maxLength={2000} rows={3} onChangeText={(v) => set({ cause: v })} />
        </Field>
        <Field label={t("maint.workOrders.edit.workDone")}>
          <TextArea value={form.workDone} maxLength={4000} rows={4} onChangeText={(v) => set({ workDone: v })} />
        </Field>
        <Field
          label={t("maint.workOrders.edit.labour")}
          hint={t("maint.workOrders.edit.labourHint")}
          error={problem === "labour" ? t("maint.workOrders.edit.labourBad") : undefined}
        >
          <TextInput inputMode="text" value={form.labour} onChangeText={(v) => set({ labour: v })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("maint.workOrders.edit.started")}>
            <TextInput type="datetime-local" value={form.startedAt} onChangeText={(v) => set({ startedAt: v })} />
          </Field>
          <Field label={t("maint.workOrders.edit.finished")} error={problem === "finishBeforeStart" ? t("maint.workOrders.edit.finishBeforeStart") : undefined}>
            <TextInput type="datetime-local" value={form.finishedAt} onChangeText={(v) => set({ finishedAt: v })} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={!dirty || problem !== null}>
            {t("maint.workOrders.edit.save")}
          </Button>
          {attempted && !dirty && problem === null ? <span className="text-[13px] text-muted-foreground">{t("maint.workOrders.edit.nothing")}</span> : null}
        </div>
      </form>
    </section>
  );
}
