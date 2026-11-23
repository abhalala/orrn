/** `/hr/training`: the training register (course, date, trainer, validity, people) and who is due for a refresher. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { matchesPerson } from "./model";
import { HrGate, HrTabs, LoadError, Section, errorText, useToday } from "./ui";

type TrainingState = "valid" | "due_soon" | "expired" | "no_expiry";

export function TrainingStateChip({ state }: { state: TrainingState }) {
  const { t } = useT();
  const tone = state === "valid" ? "green" : state === "due_soon" ? "amber" : state === "expired" ? "red" : "neutral";
  return (
    <Chip tone={tone} truncate={false}>
      {t(`hr.training.state.${state}`)}
    </Chip>
  );
}

export function TrainingPage() {
  const { t } = useT();
  const fmt = useFmt();
  const [adding, setAdding] = useState(false);
  const list = useQuery(trpc.hr.training.list.queryOptions({}));
  const due = useQuery(trpc.hr.training.due.queryOptions());
  return (
    <HrGate needs={["hr.view"]}>
      <PageHeader
        title={t("hr.training.title")}
        subtitle={t("hr.training.subtitle")}
        back={{ to: "/hr", label: t("hr.title") }}
        actions={
          <Can do="hr.manage">
            <Button className="max-md:h-14 max-md:w-full max-md:text-[17px]" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("hr.training.add")}
            </Button>
          </Can>
        }
      />
      <HrTabs current="training" />

      <Section id="hr-due" title={t("hr.training.dueTitle")} hint={t("hr.training.dueHint")}>
        {due.isPending ? <Skeleton className="h-20 w-full rounded-card" /> : null}
        {due.isError ? <LoadError onRetry={() => void due.refetch()} /> : null}
        {due.data && due.data.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.training.dueNone")}</p> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(due.data ?? []).map((r) => (
            <li key={`${r.employeeId}-${r.course}`} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border p-3">
              <div className="min-w-0">
                <p className="m-0 text-[14px] font-semibold">
                  <Link to={"/hr/$id" as never} params={{ id: r.employeeId } as never} className="underline-offset-4 hover:underline">
                    {r.name}
                  </Link>{" "}
                  <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                </p>
                <p className="m-0 text-xs text-muted-foreground">
                  {r.course} · {t("hr.training.lastOn", { date: bookDateText(fmt, r.lastOn) })}
                  {r.expiresOn ? ` · ${t("hr.training.expires", { date: bookDateText(fmt, r.expiresOn) })}` : ""}
                </p>
              </div>
              <TrainingStateChip state={r.state} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="hr-register" title={t("hr.training.registerTitle")}>
        {list.isPending ? <Skeleton className="h-32 w-full rounded-card" /> : null}
        {list.isError ? <LoadError onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.length === 0 ? <EmptyState title={t("hr.training.empty")} /> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(list.data ?? []).map((s) => (
            <li key={s.id} className="rounded-card border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-[14px] font-semibold">{s.course}</p>
                <TrainingStateChip state={s.state} />
              </div>
              <p className="m-0 text-xs text-muted-foreground">
                {bookDateText(fmt, s.day)}
                {s.trainer ? ` · ${t("hr.training.byTrainer", { trainer: s.trainer })}` : ""}
                {s.validityMonths > 0 ? ` · ${t("hr.training.validFor", { months: s.validityMonths })}` : ` · ${t("hr.training.noExpiry")}`}
              </p>
              <p className="m-0 mt-1 text-[13px]">{s.people.map((p) => p.name).join(", ")}</p>
              {s.note ? <p className="m-0 mt-1 text-xs text-muted-foreground">{s.note}</p> : null}
            </li>
          ))}
        </ul>
      </Section>
      <TrainingSheet open={adding} onOpenChange={setAdding} />
    </HrGate>
  );
}

function TrainingSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const today = useToday();
  const people = useQuery({ ...trpc.hr.people.options.queryOptions({}), enabled: open });
  const [course, setCourse] = useState("");
  const [day, setDay] = useState(today);
  const [trainer, setTrainer] = useState("");
  const [months, setMonths] = useState("12");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCourse("");
    setDay(today);
    setTrainer("");
    setMonths("12");
    setNote("");
    setPicked(new Set());
    setSearch("");
    setTried(false);
    // The form restarts at each opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = useMemo(() => (people.data ?? []).filter((p) => matchesPerson(p, search)), [people.data, search]);
  const monthsNum = /^\d{1,3}$/.test(months.trim()) ? Number(months) : null;
  const monthsOk = monthsNum !== null && monthsNum <= 120;
  const courseOk = course.trim().length > 0;
  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(day);

  const save = useMutation({
    ...trpc.hr.training.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.training.pathKey() });
      toast.success(t("hr.training.saved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("hr.training.sheetTitle")}
      description={t("hr.training.sheetHint")}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (!courseOk || !dayOk || !monthsOk || picked.size === 0) return;
              save.mutate({ course: course.trim(), day, trainer: trainer.trim() || null, validityMonths: monthsNum!, note: note.trim() || null, employeeIds: [...picked] });
            }}
          >
            {t("hr.training.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("hr.training.course")} required error={tried && !courseOk ? t("hr.training.courseBad") : undefined}>
          <TextInput value={course} onChangeText={setCourse} maxLength={80} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.training.date")} required error={tried && !dayOk ? t("hr.training.dateBad") : undefined}>
            <TextInput type="date" value={day} onChangeText={setDay} />
          </Field>
          <Field label={t("hr.training.validity")} hint={t("hr.training.validityHint")} error={tried && !monthsOk ? t("hr.training.validityBad") : undefined}>
            <NumberInput value={months} onValueChange={setMonths} decimal={false} />
          </Field>
        </div>
        <Field label={t("hr.training.trainer")}>
          <TextInput value={trainer} onChangeText={setTrainer} maxLength={80} />
        </Field>
        <Field label={t("hr.training.note")}>
          <TextInput value={note} onChangeText={setNote} maxLength={300} />
        </Field>
        <section aria-labelledby="hr-train-people" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="hr-train-people" className="m-0 text-[14px] font-semibold">
              {t("hr.training.people")} <span className="text-muted-foreground">({picked.size})</span>
            </h3>
            <Button variant="secondary" size="sm" onClick={() => setPicked(new Set(shown.map((p) => p.id)))}>
              {t("hr.training.pickAll")}
            </Button>
          </div>
          <TextInput type="search" aria-label={t("hr.people.search")} placeholder={t("hr.people.searchHint")} value={search} onChangeText={setSearch} />
          {tried && picked.size === 0 ? <p role="alert" className="m-0 text-[13px] text-destructive">{t("hr.training.peopleBad")}</p> : null}
          {people.isPending ? <Skeleton className="h-24 w-full rounded-card" /> : null}
          <ul className="m-0 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0">
            {shown.map((p) => (
              <li key={p.id} className="flex min-h-11 items-center gap-3 rounded-card border border-border px-3">
                <Checkbox id={`tp-${p.id}`} checked={picked.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />
                <label htmlFor={`tp-${p.id}`} className="min-w-0 flex-1 text-[14px]">
                  {p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Sheet>
  );
}
