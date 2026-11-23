import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { emptyKindForm, formFromKind, kindPayload, kindProblem, limitWords, type KindFormState } from "./asset-model";
import { Section } from "./asset-parts";
import { FLAG_TONE, isReadingFlag, maintErrorKey, milliText, parseMilli } from "./model";

export type KindItem = { id: string; name: string; unit: string; minMilli: number | null; maxMilli: number | null; active: boolean };
export type ReadingItem = {
  id: string;
  kindId: string;
  valueMilli: number;
  flag: string;
  note: string | null;
  readAt: number;
  workOrderId: string | null;
};

export function FlagChip({ flag }: { flag: string }) {
  const { t } = useT();
  return isReadingFlag(flag) ? (
    <Chip tone={FLAG_TONE[flag]} truncate={false}>
      {t(`maint.flag.${flag}`)}
    </Chip>
  ) : null;
}

/** A recent reading: value with the plant's own unit, flag chip, time, note. */
export function ReadingLine({ reading, kind, when, action }: { reading: ReadingItem; kind: KindItem | undefined; when: (at: number) => string; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0" data-testid="reading-line">
      <div className="min-w-0">
        <p className="m-0 text-[15px]">
          {kind ? <span className="text-muted-foreground">{kind.name} </span> : null}
          <span className="font-mono font-semibold tabular-nums">{milliText(reading.valueMilli)}</span>
          {kind ? <span> {kind.unit}</span> : null}
        </p>
        <p className="m-0 text-[13px] text-muted-foreground">
          {when(reading.readAt)}
          {reading.note ? ` · ${reading.note}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FlagChip flag={reading.flag} />
        {action}
      </div>
    </li>
  );
}

export function ReadingsSection({ assetId, kinds, readings, when }: { assetId: string; kinds: readonly KindItem[]; readings: readonly ReadingItem[]; when: (at: number) => string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<KindItem | "new" | null>(null);
  const [taking, setTaking] = useState<KindItem | null>(null);
  const kindOf = new Map(kinds.map((k) => [k.id, k]));
  const makeWo = useOnceMutation(
    trpc.maint.readings.makeWorkOrder.mutationOptions({
      onSuccess: (r) => {
        void queryClient.invalidateQueries(trpc.maint.pathFilter());
        void navigate({ to: "/maintenance/work-orders/$id", params: { id: r.id } });
      },
      onError: (e) => toast.error(t(maintErrorKey(e))),
    }),
  );
  return (
    <Section
      title={t("maint.assets.readings.title")}
      hint={t("maint.assets.readings.hint")}
      testId="asset-readings"
      actions={
        <Can do="maint.manage">
          <Button variant="secondary" onClick={() => setEditing("new")}>
            {t("maint.assets.readings.addKind")}
          </Button>
        </Can>
      }
    >
      {kinds.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("maint.assets.readings.kindEmpty")}</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
          {kinds.map((k) => {
            const limits = limitWords(k.minMilli, k.maxMilli, milliText, k.unit);
            return (
              <li key={k.id} className={`flex min-w-0 flex-col gap-2 rounded-card border border-border p-3 ${k.active ? "" : "opacity-60"}`} data-testid="reading-kind" data-active={k.active}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 text-[15px] font-semibold break-words">
                      {k.name} <span className="font-normal text-muted-foreground">({k.unit})</span>
                    </p>
                    <p className="m-0 text-[13px] text-muted-foreground">{limits ? t(limits.key, limits.vars) : t("maint.assets.readings.noLimits")}</p>
                  </div>
                  {!k.active ? (
                    <Chip tone="neutral" truncate={false}>
                      {t("maint.assets.readings.inactive")}
                    </Chip>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Can do="maint.workorder">
                    {k.active ? (
                      <Button variant="secondary" size="sm" onClick={() => setTaking(k)}>
                        {t("maint.assets.readings.take")}
                      </Button>
                    ) : null}
                  </Can>
                  <Can do="maint.manage">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(k)}>
                      {t("maint.assets.readings.editKind")}
                    </Button>
                  </Can>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="m-0 mt-2 text-[15px] font-semibold">{t("maint.assets.readings.recent")}</h3>
      {readings.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("maint.assets.readings.recentEmpty")}</p>
      ) : (
        <ul className="m-0 list-none p-0" data-testid="recent-readings">
          {readings.map((r) => (
            <ReadingLine
              key={r.id}
              reading={r}
              kind={kindOf.get(r.kindId)}
              when={when}
              action={
                r.flag !== "ok" && !r.workOrderId ? (
                  <Can do="maint.workorder">
                    <Button variant="secondary" size="sm" loading={makeWo.isPending && makeWo.variables?.readingId === r.id} onClick={() => makeWo.mutate({ readingId: r.id })}>
                      {t("maint.assets.readings.makeWorkOrder")}
                    </Button>
                  </Can>
                ) : null
              }
            />
          ))}
        </ul>
      )}
      <Can do="maint.manage">
        <KindSheet assetId={assetId} kind={editing && editing !== "new" ? editing : undefined} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      </Can>
      <Can do="maint.workorder">
        <TakeSheet kind={taking} onClose={() => setTaking(null)} />
      </Can>
    </Section>
  );
}

function KindSheet({ assetId, kind, open, onOpenChange }: { assetId: string; kind?: KindItem; open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<KindFormState>(emptyKindForm);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(kind ? formFromKind(kind, milliText) : emptyKindForm());
      setTried(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const done = () => {
    void queryClient.invalidateQueries(trpc.maint.pathFilter());
    toast.success(t("maint.assets.readings.kindSaved"));
    onOpenChange(false);
  };
  const onError = (e: unknown) => toast.error(t(maintErrorKey(e)));
  const create = useOnceMutation(trpc.maint.readings.createKind.mutationOptions({ onSuccess: done, onError }));
  const update = useOnceMutation(trpc.maint.readings.updateKind.mutationOptions({ onSuccess: done, onError }));
  const busy = create.isPending || update.isPending;
  const problem = kindProblem(form);
  const patch = (p: Partial<KindFormState>) => setForm((f) => ({ ...f, ...p }));
  const submit = () => {
    setTried(true);
    if (problem) return;
    if (kind) update.mutate({ id: kind.id, ...kindPayload(form), active: form.active });
    else create.mutate({ assetId, ...kindPayload(form) });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      dismissible={!busy}
      title={kind ? t("maint.assets.readings.editKind") : t("maint.assets.readings.addKind")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={submit}>
            {t("maint.assets.readings.saveKind")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {tried && problem ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
            {problem === "name" ? t("maint.assets.readings.needsName") : t("maint.assets.readings.needsLimit")}
          </p>
        ) : null}
        <Field label={t("maint.assets.readings.kindName")} required>
          <TextInput value={form.name} onChange={(e) => patch({ name: e.currentTarget.value })} maxLength={80} autoComplete="off" />
        </Field>
        <Field label={t("maint.assets.readings.unit")} hint={t("maint.assets.readings.unitHint")} required>
          <TextInput value={form.unit} onChange={(e) => patch({ unit: e.currentTarget.value })} maxLength={20} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("maint.assets.readings.low")}>
            <TextInput inputMode="decimal" value={form.low} onChange={(e) => patch({ low: e.currentTarget.value })} />
          </Field>
          <Field label={t("maint.assets.readings.high")}>
            <TextInput inputMode="decimal" value={form.high} onChange={(e) => patch({ high: e.currentTarget.value })} />
          </Field>
        </div>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("maint.assets.readings.limitHint")}</p>
        {kind ? (
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox id="kind-active" checked={form.active} onCheckedChange={(v) => patch({ active: v === true })} />
            <label htmlFor="kind-active" className="text-[15px] leading-5 font-medium">
              {t("maint.assets.readings.active")}
            </label>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function TakeSheet({ kind, onClose }: { kind: KindItem | null; onClose(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [flag, setFlag] = useState<string | null>(null);
  useEffect(() => {
    setValue("");
    setNote("");
    setTried(false);
    setFlag(null);
  }, [kind?.id]);
  const record = useOnceMutation(
    trpc.maint.readings.record.mutationOptions({
      onSuccess: (r) => {
        setFlag(r.flag);
        void queryClient.invalidateQueries(trpc.maint.pathFilter());
        toast.success(t("maint.assets.readings.recorded"));
      },
      onError: (e) => toast.error(t(maintErrorKey(e))),
    }),
  );
  const parsed = parseMilli(value);
  const submit = () => {
    setTried(true);
    if (!kind || parsed == null) return;
    record.mutate({ kindId: kind.id, valueMilli: parsed, ...(note.trim() ? { note: note.trim() } : {}) });
  };
  return (
    <Sheet
      open={kind !== null}
      onOpenChange={(o) => {
        if (!o && !record.isPending) onClose();
      }}
      dismissible={!record.isPending}
      title={kind ? `${t("maint.assets.readings.take")}: ${kind.name}` : t("maint.assets.readings.take")}
      footer={
        <>
          <Button variant="secondary" disabled={record.isPending} onClick={onClose}>
            {t("common.close")}
          </Button>
          {flag === null ? (
            <Button loading={record.isPending} onClick={submit}>
              {t("maint.assets.readings.record")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={`${t("maint.assets.readings.value")}${kind ? ` (${kind.unit})` : ""}`} error={tried && parsed == null ? t("maint.assets.readings.needsValue") : undefined} required>
          <TextInput inputMode="decimal" value={value} disabled={flag !== null} onChange={(e) => setValue(e.currentTarget.value)} autoComplete="off" />
        </Field>
        <Field label={t("maint.assets.readings.note")}>
          <TextInput value={note} disabled={flag !== null} onChange={(e) => setNote(e.currentTarget.value)} maxLength={500} />
        </Field>
        {flag !== null ? (
          <p className="m-0" data-testid="reading-answer">
            <FlagChip flag={flag} />
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
