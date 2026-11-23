/**
 * `/hr/settings`: the plant's dated HR rules and incentive rule (each change starts from a month and never rewrites an
 * earlier one), holidays, the joining and leaving checklist items, and who retires soon.
 */
import { DEFAULT_HR_RULES, DEFAULT_INCENTIVE_RULE, type HrRules, type IncentiveRule } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText, massUnit } from "@/shared/lib/fmt-text";
import { readUnitEntry, unitEntryText, unitProblemText } from "@/shared/lib/unit-input";
import { trpc } from "@/shared/utils/trpc";

import { bpText, formFromRules, monthOf, percentToBp, rulesFromForm, yearChoices, type RulesForm, type RulesProblem } from "./model";
import { HrGate, HrTabs, LoadError, Pick, Section, errorText, useCan, useToday } from "./ui";

export function HrSettingsPage() {
  const { t } = useT();
  return (
    <HrGate needs={["hr.view"]}>
      <PageHeader title={t("hr.settings.title")} subtitle={t("hr.settings.subtitle")} back={{ to: "/hr", label: t("hr.title") }} />
      <HrTabs current="settings" />
      <RulesSection />
      <IncentiveSection />
      <HolidaysSection />
      <ChecklistSection kind="joining" />
      <ChecklistSection kind="leaving" />
      <RetiringSection />
    </HrGate>
  );
}

function useSettings() {
  return useQuery(trpc.hr.settings.get.queryOptions());
}

const DOWS = [0, 1, 2, 3, 4, 5, 6] as const;

function RulesSection() {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const today = useToday();
  const canManage = useCan("hr.manage");
  const q = useSettings();
  const [from, setFrom] = useState(monthOf(today));
  const [form, setForm] = useState<RulesForm>(() => formFromRules(DEFAULT_HR_RULES));
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  const inForce = q.data?.rules.find((r) => r.effectiveFrom <= monthOf(today));
  useEffect(() => {
    if (q.data) setForm(formFromRules({ ...DEFAULT_HR_RULES, ...((inForce?.value as Partial<HrRules> | undefined) ?? {}) }));
    // Starts from the rule in force when the list first arrives and after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const save = useMutation({
    ...trpc.hr.settings.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.settings.pathKey() });
      toast.success(t("hr.settings.saved"));
      setNote("");
      setTried(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  const parsed = rulesFromForm(form);
  const bad = new Set<RulesProblem>(parsed.ok ? [] : parsed.problems);
  const err = (k: RulesProblem) => (tried && bad.has(k) ? t(`hr.rules.bad.${k}`) : undefined);
  const set = <K extends keyof RulesForm>(k: K, v: RulesForm[K]) => setForm((p) => ({ ...p, [k]: v }));
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(from);

  return (
    <Section id="hr-rules" title={t("hr.rules.title")} hint={t("hr.rules.hint")}>
      {q.isPending ? <Skeleton className="h-40 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <p className="m-0 text-[13px] text-muted-foreground">{inForce ? t("hr.settings.inForce", { from: inForce.effectiveFrom }) : t("hr.settings.defaults")}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("hr.rules.retirementAge")} error={err("retirementAge")}>
              <NumberInput disabled={!canManage} value={form.retirementAge} onValueChange={(v) => set("retirementAge", v)} decimal={false} />
            </Field>
            <Field label={t("hr.rules.weeklyOff")}>
              <Pick value={form.weeklyOffDow} onChange={(v) => set("weeklyOffDow", v)} disabled={!canManage} options={DOWS.map((d) => ({ value: String(d), label: t(`hr.dow.d${d}`) }))} />
            </Field>
            <Field label={t("hr.rules.hoursPerDay")} hint={t("hr.rules.hoursPerDayHint")} error={err("hoursPerDay")}>
              <NumberInput disabled={!canManage} value={form.hoursPerDay} onValueChange={(v) => set("hoursPerDay", v)} decimal={false} />
            </Field>
            <Field label={t("hr.rules.overtimeMin")} hint={t("hr.rules.overtimeMinHint")} error={err("overtimeMinMinutes")}>
              <NumberInput disabled={!canManage} value={form.overtimeMinMinutes} onValueChange={(v) => set("overtimeMinMinutes", v)} decimal={false} />
            </Field>
            <Field label={t("hr.rules.overtimeStep")} hint={t("hr.rules.overtimeStepHint")} error={err("overtimeStepMinutes")}>
              <NumberInput disabled={!canManage} value={form.overtimeStepMinutes} onValueChange={(v) => set("overtimeStepMinutes", v)} decimal={false} />
            </Field>
            <Field label={t("hr.rules.overtimeRate")} hint={t("hr.rules.overtimeRateHint")} error={err("overtimeRate")}>
              <NumberInput disabled={!canManage} value={form.overtimeRate} onValueChange={(v) => set("overtimeRate", v)} />
            </Field>
            <Field label={t("hr.rules.overtimeBase")} hint={t("hr.rules.overtimeBaseHint")}>
              <Pick
                value={form.overtimeBase}
                onChange={(v) => set("overtimeBase", v as RulesForm["overtimeBase"])}
                disabled={!canManage}
                options={[
                  { value: "basic_da", label: t("hr.rules.baseBasic") },
                  { value: "gross", label: t("hr.rules.baseGross") },
                ]}
              />
            </Field>
            <Field label={t("hr.rules.monthDays")} hint={t("hr.rules.monthDaysHint")}>
              <Pick
                value={form.monthDaysBasis}
                onChange={(v) => set("monthDaysBasis", v as RulesForm["monthDaysBasis"])}
                disabled={!canManage}
                options={[
                  { value: "calendar", label: t("hr.rules.daysCalendar") },
                  { value: "26", label: t("hr.rules.days26") },
                  { value: "30", label: t("hr.rules.days30") },
                ]}
              />
            </Field>
            <Field label={t("hr.rules.bonus")} hint={t("hr.rules.bonusHint")} error={err("bonusPercent")}>
              <NumberInput disabled={!canManage} value={form.bonusPercent} onValueChange={(v) => set("bonusPercent", v)} />
            </Field>
            <Field label={t("hr.rules.encash")} hint={t("hr.rules.encashHint")} error={err("encashDivisor")}>
              <NumberInput disabled={!canManage} value={form.encashDivisor} onValueChange={(v) => set("encashDivisor", v)} decimal={false} />
            </Field>
          </div>
          <Can do="hr.manage">
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
              <Field label={t("hr.settings.effectiveFrom")} hint={t("hr.settings.effectiveHint")} error={tried && !monthOk ? t("hr.settings.monthBad") : undefined}>
                <TextInput type="month" value={from} onChangeText={setFrom} />
              </Field>
              <Field label={t("hr.settings.note")}>
                <TextInput value={note} onChangeText={setNote} maxLength={300} />
              </Field>
              <Button
                loading={save.isPending}
                onClick={() => {
                  setTried(true);
                  if (!parsed.ok || !monthOk) return;
                  save.mutate({ kind: "rules", effectiveFrom: from, value: parsed.value, note: note.trim() || null });
                }}
              >
                {t("hr.settings.save")}
              </Button>
            </div>
          </Can>
          <History rows={q.data.rules} />
        </>
      ) : null}
    </Section>
  );
}

function History({ rows }: { rows: { id: string; effectiveFrom: string; note: string | null }[] }) {
  const { t } = useT();
  if (rows.length === 0) return null;
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer font-semibold">{t("hr.settings.history", { count: rows.length })}</summary>
      <ul className="m-0 mt-2 list-none p-0">
        {rows.map((r) => (
          <li key={r.id} className="py-0.5">
            <span className="font-mono">{r.effectiveFrom}</span>
            {r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

type IncText = { target: string; rate: string; floor: string; penalty: string };

function incText(fmt: ReturnType<typeof useFmt>, r: IncentiveRule): IncText {
  return {
    target: unitEntryText(fmt, "order.weight", r.targetG),
    rate: unitEntryText(fmt, "order.rate", r.ratePaisePerKg),
    floor: bpText(r.recoveryFloorBp),
    penalty: unitEntryText(fmt, "order.rate", r.rejectPenaltyPaisePerKg),
  };
}

function IncentiveSection() {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const today = useToday();
  const canManage = useCan("hr.manage");
  const q = useSettings();
  const [from, setFrom] = useState(monthOf(today));
  const [text, setText] = useState<IncText>(() => incText(fmt, DEFAULT_INCENTIVE_RULE));
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  const inForce = q.data?.incentive.find((r) => r.effectiveFrom <= monthOf(today));
  useEffect(() => {
    if (q.data) setText(incText(fmt, { ...DEFAULT_INCENTIVE_RULE, ...((inForce?.value as Partial<IncentiveRule> | undefined) ?? {}) }));
    // Starts from the rule in force when the list first arrives and after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const save = useMutation({
    ...trpc.hr.settings.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.settings.pathKey() });
      toast.success(t("hr.settings.saved"));
      setNote("");
      setTried(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  const target = readUnitEntry(fmt, "order.weight", text.target);
  const rate = readUnitEntry(fmt, "order.rate", text.rate);
  const penalty = readUnitEntry(fmt, "order.rate", text.penalty);
  const floorBp = percentToBp(text.floor || "0");
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(from);
  const entryErr = (e: ReturnType<typeof readUnitEntry>, field: "order.weight" | "order.rate") => (tried && e.state === "refused" ? unitProblemText(t, fmt, field, e.problem) : undefined);
  const valueOf = (e: ReturnType<typeof readUnitEntry>) => (e.state === "ok" ? e.value : e.state === "blank" ? 0 : null);
  const set = <K extends keyof IncText>(k: K, v: string) => setText((p) => ({ ...p, [k]: v }));

  return (
    <Section id="hr-incentive-rule" title={t("hr.incentiveRule.title")} hint={t("hr.incentiveRule.hint")}>
      {q.isPending ? <Skeleton className="h-32 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <>
          <p className="m-0 text-[13px] text-muted-foreground">{inForce ? t("hr.settings.inForce", { from: inForce.effectiveFrom }) : t("hr.incentiveRule.none")}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("hr.incentiveRule.target")} hint={t("hr.incentiveRule.targetHint", { massUnit: massUnit(fmt) })} error={entryErr(target, "order.weight")}>
              <NumberInput disabled={!canManage} value={text.target} onValueChange={(v) => set("target", v)} />
            </Field>
            <Field label={t("hr.incentiveRule.rate")} hint={t("hr.incentiveRule.rateHint")} error={entryErr(rate, "order.rate")}>
              <NumberInput disabled={!canManage} value={text.rate} onValueChange={(v) => set("rate", v)} />
            </Field>
            <Field label={t("hr.incentiveRule.floor")} hint={t("hr.incentiveRule.floorHint")} error={tried && floorBp === null ? t("hr.incentiveRule.floorBad") : undefined}>
              <NumberInput disabled={!canManage} value={text.floor} onValueChange={(v) => set("floor", v)} />
            </Field>
            <Field label={t("hr.incentiveRule.penalty")} hint={t("hr.incentiveRule.penaltyHint")} error={entryErr(penalty, "order.rate")}>
              <NumberInput disabled={!canManage} value={text.penalty} onValueChange={(v) => set("penalty", v)} />
            </Field>
          </div>
          <Can do="hr.manage">
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
              <Field label={t("hr.settings.effectiveFrom")} hint={t("hr.settings.effectiveHint")} error={tried && !monthOk ? t("hr.settings.monthBad") : undefined}>
                <TextInput type="month" value={from} onChangeText={setFrom} />
              </Field>
              <Field label={t("hr.settings.note")}>
                <TextInput value={note} onChangeText={setNote} maxLength={300} />
              </Field>
              <Button
                loading={save.isPending}
                onClick={() => {
                  setTried(true);
                  const targetG = valueOf(target);
                  const ratePaisePerKg = valueOf(rate);
                  const rejectPenaltyPaisePerKg = valueOf(penalty);
                  if (targetG === null || ratePaisePerKg === null || rejectPenaltyPaisePerKg === null || floorBp === null || !monthOk) return;
                  save.mutate({ kind: "incentive", effectiveFrom: from, value: { targetG, ratePaisePerKg, recoveryFloorBp: floorBp, rejectPenaltyPaisePerKg }, note: note.trim() || null });
                }}
              >
                {t("hr.settings.save")}
              </Button>
            </div>
          </Can>
          <History rows={q.data.incentive} />
        </>
      ) : null}
    </Section>
  );
}

function HolidaysSection() {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const today = useToday();
  const years = yearChoices(today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  const [tried, setTried] = useState(false);
  const q = useQuery(trpc.hr.holidays.list.queryOptions({ year }));
  const add = useMutation({
    ...trpc.hr.holidays.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.holidays.pathKey() });
      toast.success(t("hr.holidays.saved"));
      setDay("");
      setName("");
      setTried(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const remove = useMutation({
    ...trpc.hr.holidays.remove.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.hr.holidays.pathKey() }),
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const nameOk = name.trim().length > 0;
  return (
    <Section
      id="hr-holidays"
      title={t("hr.holidays.title")}
      hint={t("hr.holidays.hint")}
      actions={
        <div className="w-28">
          <Pick compact aria-label={t("hr.balances.year")} value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
        </div>
      }
    >
      {q.isPending ? <Skeleton className="h-20 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.holidays.none")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {(q.data ?? []).map((h) => (
          <li key={h.id} className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-border px-3">
            <span className="min-w-0 text-[14px]">
              <span className="font-semibold">{bookDateText(fmt, h.day)}</span> · {h.name}
            </span>
            <Can do="hr.manage">
              <Button variant="secondary" size="sm" loading={remove.isPending && remove.variables?.id === h.id} onClick={() => remove.mutate({ id: h.id })}>
                {t("hr.holidays.remove")}
              </Button>
            </Can>
          </li>
        ))}
      </ul>
      <Can do="hr.manage">
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <Field label={t("hr.holidays.date")} error={tried && !dayOk ? t("hr.holidays.dateBad") : undefined}>
            <TextInput type="date" value={day} onChangeText={setDay} />
          </Field>
          <Field label={t("hr.holidays.name")} error={tried && !nameOk ? t("hr.holidays.nameBad") : undefined}>
            <TextInput value={name} onChangeText={setName} maxLength={60} />
          </Field>
          <Button
            loading={add.isPending}
            onClick={() => {
              setTried(true);
              if (dayOk && nameOk) add.mutate({ day, name: name.trim() });
            }}
          >
            {t("hr.holidays.add")}
          </Button>
        </div>
      </Can>
    </Section>
  );
}

function ChecklistSection({ kind }: { kind: "joining" | "leaving" }) {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery(trpc.hr.checklists.items.queryOptions({ kind }));
  const [label, setLabel] = useState("");
  const [tried, setTried] = useState(false);
  const save = useMutation({
    ...trpc.hr.checklists.saveItem.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.checklists.pathKey() });
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const labelOk = label.trim().length > 0;
  const items = q.data ?? [];
  const nextOrder = items.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 10;
  return (
    <Section id={`hr-items-${kind}`} title={t(`hr.checklist.${kind}`)} hint={t("hr.checklist.itemsHint")}>
      {q.isPending ? <Skeleton className="h-20 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && items.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.checklist.none")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((i) => (
          <li key={i.id} className="flex min-h-12 items-center gap-3 rounded-card border border-border px-3">
            <Can do="hr.manage" fallback={<span className="min-w-0 flex-1 text-[14px]">{i.label}</span>}>
              <Checkbox
                id={`item-${i.id}`}
                aria-label={t("hr.checklist.itemActive", { label: i.label })}
                checked={i.active}
                disabled={save.isPending}
                onCheckedChange={(v) => save.mutate({ id: i.id, kind, label: i.label, sortOrder: i.sortOrder, active: v === true })}
              />
              <label htmlFor={`item-${i.id}`} className={`min-w-0 flex-1 text-[14px] ${i.active ? "" : "text-muted-foreground line-through"}`}>
                {i.label}
              </label>
            </Can>
          </li>
        ))}
      </ul>
      <Can do="hr.manage">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label={t("hr.checklist.newItem")} error={tried && !labelOk ? t("hr.checklist.itemBad") : undefined}>
            <TextInput value={label} onChangeText={setLabel} maxLength={120} />
          </Field>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (!labelOk) return;
              save.mutate({ kind, label: label.trim(), sortOrder: Math.min(999, nextOrder), active: true }, { onSuccess: () => { setLabel(""); setTried(false); } });
            }}
          >
            {t("hr.checklist.addItem")}
          </Button>
        </div>
      </Can>
    </Section>
  );
}

const WINDOWS = ["30", "90", "180", "365"] as const;

function RetiringSection() {
  const { t } = useT();
  const fmt = useFmt();
  const [days, setDays] = useState<(typeof WINDOWS)[number]>("90");
  const q = useQuery(trpc.hr.people.retiring.queryOptions({ days: Number(days) }));
  return (
    <Section
      id="hr-retiring"
      title={t("hr.retiring.title")}
      hint={q.data ? t("hr.retiring.hint", { age: q.data.retirementAge }) : undefined}
      actions={
        <div className="w-40">
          <Pick compact aria-label={t("hr.retiring.window")} value={days} onChange={(v) => setDays(v as (typeof WINDOWS)[number])} options={WINDOWS.map((w) => ({ value: w, label: t("hr.retiring.next", { days: Number(w) }) }))} />
        </div>
      }
    >
      {q.isPending ? <Skeleton className="h-20 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.items.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.retiring.none")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {(q.data?.items ?? []).map((p) => (
          <li key={p.id} className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-border px-3 text-[14px]">
            <Link to={"/hr/$id" as never} params={{ id: p.id } as never} className="min-w-0 underline-offset-4 hover:underline">
              {p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
            </Link>
            <span className="whitespace-nowrap">{bookDateText(fmt, p.retiresOn)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
