/** `/hr/$id`: one person: details, joining and leaving checklists, leave balances, training and performance notes. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { halvesToDays, yearChoices, type PersonCard } from "./model";
import { PersonSheet } from "./person-sheet";
import { TrainingStateChip } from "./training-page";
import { HrGate, LoadError, Pick, Section, errorText, useToday } from "./ui";

const DOW_KEYS = ["hr.dow.d0", "hr.dow.d1", "hr.dow.d2", "hr.dow.d3", "hr.dow.d4", "hr.dow.d5", "hr.dow.d6"] as const;

type TabId = "details" | "joining" | "leaving" | "leave" | "training" | "notes";
const TABS: readonly TabId[] = ["details", "joining", "leaving", "leave", "training", "notes"];

export function PersonPage({ id }: { id: string }) {
  const { t } = useT();
  const [tab, setTab] = useState<TabId>("details");
  const q = useQuery(trpc.hr.people.get.queryOptions({ id }));
  const today = useToday();

  return (
    <HrGate needs={["hr.view"]}>
      <PageHeader
        title={q.data ? q.data.name : t("hr.title")}
        subtitle={q.data ? `${q.data.code} · ${t(`hr.kind.${q.data.kind}`)}` : undefined}
        back={{ to: "/hr", label: t("hr.title") }}
        actions={
          q.data ? (
            <Button asChild variant="secondary">
              <Link to={"/hr/timesheet" as never} search={{ id, month: today.slice(0, 7) } as never}>
                {t("hr.person.openTimesheet")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      {q.isPending ? <Skeleton className="h-64 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <Tabs label={t("hr.person.tabsLabel")} items={TABS.map((k) => ({ id: k, label: t(`hr.person.tab.${k}`) }))} value={tab} onValueChange={(v) => setTab(v as TabId)}>
          {tab === "details" ? <DetailsTab person={q.data} /> : null}
          {tab === "joining" ? <ChecklistTab person={q.data} kind="joining" /> : null}
          {tab === "leaving" ? <LeavingTab person={q.data} /> : null}
          {tab === "leave" ? <BalancesTab person={q.data} /> : null}
          {tab === "training" ? <PersonTraining person={q.data} /> : null}
          {tab === "notes" ? <NotesTab person={q.data} /> : null}
        </Tabs>
      ) : null}
    </HrGate>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-[14px] font-medium">{children || "-"}</dd>
    </div>
  );
}

function DetailsTab({ person }: { person: PersonCard }) {
  const { t } = useT();
  const fmt = useFmt();
  const [editing, setEditing] = useState(false);
  return (
    <Section
      id="hr-details"
      title={t("hr.person.tab.details")}
      actions={
        <Can do="hr.manage">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t("hr.person.edit")}
          </Button>
        </Can>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {person.status === "left" ? <Chip tone="neutral" truncate={false}>{t("hr.status.left")}</Chip> : <Chip tone="green" truncate={false}>{t("hr.status.active")}</Chip>}
        {person.status === "left" && person.leftOn ? <span className="text-[13px] text-muted-foreground">{t("hr.person.leftOn", { date: bookDateText(fmt, person.leftOn) })}</span> : null}
      </div>
      <dl className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Row label={t("hr.person.department")}>{person.department}</Row>
        <Row label={t("hr.person.designation")}>{person.designation}</Row>
        <Row label={t("hr.person.joinedOn")}>{bookDateText(fmt, person.joinedOn)}</Row>
        <Row label={t("hr.person.dob")}>{person.dob ? bookDateText(fmt, person.dob) : ""}</Row>
        <Row label={t("hr.person.phone")}>{person.phone}</Row>
        <Row label={t("hr.person.deviceCode")}>{person.deviceCode}</Row>
        {person.kind === "contract" ? <Row label={t("hr.person.contractor")}>{person.contractorName}</Row> : null}
        <Row label={t("hr.person.weeklyOff")}>{person.weeklyOffDow === null ? t("hr.person.weeklyOffPlant") : t(DOW_KEYS[person.weeklyOffDow] ?? "hr.person.weeklyOffPlant")}</Row>
        <Row label={t("hr.person.bankName")}>{person.bankName}</Row>
        <Row label={t("hr.person.account")}>
          <span className="font-mono">{person.bankAccountMasked}</span>
        </Row>
        <Row label={t("hr.person.ifsc")}>
          <span className="font-mono">{person.bankIfsc}</span>
        </Row>
        <Row label={t("hr.person.pan")}>{person.panLast4 ? <span className="font-mono">{t("hr.person.endingIn", { last4: person.panLast4 })}</span> : ""}</Row>
        <Row label={t("hr.person.aadhaar")}>{person.aadhaarLast4 ? <span className="font-mono">{t("hr.person.endingIn", { last4: person.aadhaarLast4 })}</span> : ""}</Row>
        <Row label={t("hr.person.uan")}>
          <span className="font-mono">{person.uan}</span>
        </Row>
        <Row label={t("hr.person.esic")}>
          <span className="font-mono">{person.esicIp}</span>
        </Row>
        {person.status === "left" ? <Row label={t("hr.leaving.reason")}>{person.leavingReason}</Row> : null}
      </dl>
      <PersonSheet open={editing} onOpenChange={setEditing} person={person} />
    </Section>
  );
}

function ChecklistTab({ person, kind }: { person: PersonCard; kind: "joining" | "leaving" }) {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const q = useQuery(trpc.hr.checklists.forPerson.queryOptions({ employeeId: person.id, kind }));
  const tick = useMutation({
    ...trpc.hr.checklists.tick.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.hr.checklists.pathKey() }),
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const items = q.data ?? [];
  const done = items.filter((i) => i.done).length;
  return (
    <Section id={`hr-check-${kind}`} title={t(`hr.checklist.${kind}`)} hint={items.length ? t("hr.checklist.progress", { done, total: items.length }) : undefined}>
      {q.isPending ? <Skeleton className="h-24 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && items.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.checklist.none")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((i) => (
          <li key={i.itemId} className="flex min-h-12 items-center gap-3 rounded-card border border-border px-3">
            <Can
              do="hr.manage"
              fallback={<Chip tone={i.done ? "green" : "neutral"} truncate={false}>{i.done ? t("hr.checklist.done") : t("hr.checklist.notDone")}</Chip>}
            >
              <Checkbox
                id={`tick-${kind}-${i.itemId}`}
                aria-label={i.label}
                checked={i.done}
                disabled={tick.isPending}
                onCheckedChange={(v) => tick.mutate({ employeeId: person.id, itemId: i.itemId, done: v === true })}
              />
            </Can>
            <label htmlFor={`tick-${kind}-${i.itemId}`} className="min-w-0 flex-1 text-[14px]">
              {i.label}
            </label>
            {i.doneAt ? <span className="text-xs text-muted-foreground">{fmt.date(new Date(i.doneAt).getTime())}</span> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LeavingTab({ person }: { person: PersonCard }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rejoin = useMutation({
    ...trpc.hr.people.rejoin.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.people.pathKey() });
      toast.success(t("hr.leaving.rejoined"));
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  return (
    <>
      <ChecklistTab person={person} kind="leaving" />
      <Can do="hr.manage">
        <Section id="hr-leaving" title={t("hr.leaving.title")} hint={person.status === "left" ? t("hr.leaving.leftHint") : t("hr.leaving.hint")}>
          <div>
            {person.status === "left" ? (
              <Button variant="secondary" loading={rejoin.isPending} onClick={() => rejoin.mutate({ id: person.id })}>
                {t("hr.leaving.rejoin")}
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setOpen(true)}>
                {t("hr.leaving.action")}
              </Button>
            )}
          </div>
        </Section>
        <LeavingSheet person={person} open={open} onOpenChange={setOpen} />
      </Can>
    </>
  );
}

function LeavingSheet({ person, open, onOpenChange }: { person: PersonCard; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const today = useToday();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const save = useMutation({
    ...trpc.hr.people.leave.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.people.pathKey() });
      toast.success(t("hr.leaving.saved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= person.joinedOn;
  const reasonOk = reason.trim().length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("hr.leaving.sheetTitle", { name: person.name })}
      description={t("hr.leaving.sheetHint")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (dateOk && reasonOk) save.mutate({ id: person.id, leftOn: date, reason: reason.trim() });
            }}
          >
            {t("hr.leaving.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("hr.leaving.date")} required error={tried && !dateOk ? t("hr.leaving.dateBad") : undefined}>
          <TextInput type="date" value={date} onChangeText={setDate} />
        </Field>
        <Field label={t("hr.leaving.reason")} required error={tried && !reasonOk ? t("hr.leaving.reasonBad") : undefined}>
          <TextInput value={reason} onChangeText={setReason} maxLength={300} />
        </Field>
      </div>
    </Sheet>
  );
}

function BalancesTab({ person }: { person: PersonCard }) {
  const { t } = useT();
  const today = useToday();
  const years = yearChoices(today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const q = useQuery(trpc.hr.leave.balances.queryOptions({ employeeId: person.id, year }));
  return (
    <Section
      id="hr-balances"
      title={t("hr.person.tab.leave")}
      hint={t("hr.balances.hint")}
      actions={
        <div className="w-32">
          <Pick compact aria-label={t("hr.balances.year")} value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
        </div>
      }
    >
      {q.isPending ? <Skeleton className="h-24 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.balances.none")}</p> : null}
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {(q.data ?? []).map((b) => (
          <li key={b.kindId} className="rounded-card border border-border p-3">
            <p className="m-0 flex items-center justify-between gap-2 text-[14px] font-semibold">
              <span>
                {b.name} <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
              </span>
              <Chip tone={b.paid ? "green" : "neutral"} truncate={false}>
                {b.paid ? t("hr.leave.paid") : t("hr.leave.unpaid")}
              </Chip>
            </p>
            <p className="m-0 mt-1 text-[28px] font-bold leading-none tabular-nums">{halvesToDays(b.balanceHalves)}</p>
            <p className="m-0 text-xs text-muted-foreground">{t("hr.balances.left")}</p>
            <dl className="m-0 mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">{t("hr.balances.carried")}</dt>
                <dd className="m-0 font-semibold tabular-nums">{halvesToDays(b.carryInHalves)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("hr.balances.quota")}</dt>
                <dd className="m-0 font-semibold tabular-nums">{halvesToDays(b.quotaHalves)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("hr.balances.taken")}</dt>
                <dd className="m-0 font-semibold tabular-nums">{halvesToDays(b.takenHalves)}</dd>
              </div>
            </dl>
            {b.pendingHalves > 0 ? <p className="m-0 mt-2 text-xs text-muted-foreground">{t("hr.balances.waiting", { days: halvesToDays(b.pendingHalves), count: b.pendingHalves / 2 })}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PersonTraining({ person }: { person: PersonCard }) {
  const { t } = useT();
  const fmt = useFmt();
  const q = useQuery(trpc.hr.training.list.queryOptions({ employeeId: person.id }));
  return (
    <Section id="hr-ptraining" title={t("hr.person.tab.training")} actions={<Button asChild variant="secondary"><Link to={"/hr/training" as never}>{t("hr.person.openTraining")}</Link></Button>}>
      {q.isPending ? <Skeleton className="h-24 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.training.noneForPerson")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {(q.data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border p-3">
            <div className="min-w-0">
              <p className="m-0 text-[14px] font-semibold">{s.course}</p>
              <p className="m-0 text-xs text-muted-foreground">
                {bookDateText(fmt, s.day)}
                {s.expiresOn ? ` · ${t("hr.training.expires", { date: bookDateText(fmt, s.expiresOn) })}` : ""}
              </p>
            </div>
            <TrainingStateChip state={s.state} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function NotesTab({ person }: { person: PersonCard }) {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery(trpc.hr.reviews.list.queryOptions({ employeeId: person.id }));
  return (
    <Section
      id="hr-notes"
      title={t("hr.person.tab.notes")}
      hint={t("hr.notes.hint")}
      actions={
        <Can do="hr.manage">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t("hr.notes.add")}
          </Button>
        </Can>
      }
    >
      {q.isPending ? <Skeleton className="h-24 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? <EmptyState title={t("hr.notes.none")} /> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {(q.data ?? []).map((r) => (
          <li key={r.id} className="rounded-card border border-border p-3">
            <p className="m-0 flex flex-wrap items-center justify-between gap-2 text-[14px] font-semibold">
              <span>{r.period}</span>
              <Chip tone={r.rating >= 4 ? "green" : r.rating >= 3 ? "blue" : "amber"} truncate={false}>
                {t("hr.notes.rating", { rating: r.rating })}
              </Chip>
            </p>
            {r.remarks ? <p className="m-0 mt-1 text-[14px]">{r.remarks}</p> : null}
            <p className="m-0 mt-1 text-xs text-muted-foreground">{fmt.date(new Date(r.createdAt).getTime())}</p>
          </li>
        ))}
      </ul>
      <NoteSheet person={person} open={adding} onOpenChange={setAdding} onSaved={() => void qc.invalidateQueries({ queryKey: trpc.hr.reviews.pathKey() })} />
    </Section>
  );
}

function NoteSheet({ person, open, onOpenChange, onSaved }: { person: PersonCard; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { t } = useT();
  const today = useToday();
  const [period, setPeriod] = useState(today.slice(0, 4));
  const [rating, setRating] = useState("3");
  const [remarks, setRemarks] = useState("");
  const [tried, setTried] = useState(false);
  const save = useMutation({
    ...trpc.hr.reviews.add.mutationOptions(),
    onSuccess: () => {
      toast.success(t("hr.notes.saved"));
      setRemarks("");
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const periodOk = period.trim().length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("hr.notes.sheetTitle", { name: person.name })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (periodOk) save.mutate({ employeeId: person.id, period: period.trim(), rating: Number(rating), remarks: remarks.trim() || null });
            }}
          >
            {t("hr.notes.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("hr.notes.period")} required hint={t("hr.notes.periodHint")} error={tried && !periodOk ? t("hr.notes.periodBad") : undefined}>
          <TextInput value={period} onChangeText={setPeriod} maxLength={20} />
        </Field>
        <Field label={t("hr.notes.ratingLabel")} hint={t("hr.notes.ratingHint")}>
          <Pick value={rating} onChange={setRating} options={["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label={t("hr.notes.remarks")}>
          <TextInput value={remarks} onChangeText={setRemarks} maxLength={1000} />
        </Field>
      </div>
    </Sheet>
  );
}

