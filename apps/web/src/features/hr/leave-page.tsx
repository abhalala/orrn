/** `/hr/leave`: who is waiting for leave to be decided, applying for someone, cancelling, and the leave kinds. Days are halves on the wire. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { daysToHalves, halvesToDays } from "./model";
import { HrGate, HrTabs, LoadError, Pick, Section, errorText, useToday } from "./ui";

type StatusTab = "pending" | "approved" | "all";

export function LeavePage() {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusTab>("pending");
  const [applying, setApplying] = useState(false);
  const list = useQuery(trpc.hr.leave.requests.queryOptions({ status }));
  const cancel = useMutation({
    ...trpc.hr.leave.cancel.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.leave.pathKey() });
      toast.success(t("hr.leave.cancelled"));
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  return (
    <HrGate needs={["hr.view", "leave.approve"]}>
      <PageHeader
        title={t("hr.leave.title")}
        subtitle={t("hr.leave.subtitle")}
        back={{ to: "/hr", label: t("hr.title") }}
        actions={
          <Can do="leave.approve">
            <Button className="max-md:h-14 max-md:w-full max-md:text-[17px]" onClick={() => setApplying(true)}>
              {t("hr.leave.applyFor")}
            </Button>
          </Can>
        }
      />
      <HrTabs current="leave" />

      <Section
        id="hr-leave-requests"
        title={t("hr.leave.requestsTitle")}
        hint={t("hr.leave.decideHint")}
        actions={
          <Button asChild variant="secondary">
            <Link to={"/approvals" as never}>{t("hr.leave.openApprovals")}</Link>
          </Button>
        }
      >
        <SegmentedControl
          label={t("hr.leave.statusLabel")}
          value={status}
          onChange={setStatus}
          options={[
            { value: "pending" as StatusTab, label: t("hr.leave.status.pending") },
            { value: "approved" as StatusTab, label: t("hr.leave.status.approved") },
            { value: "all" as StatusTab, label: t("hr.people.all") },
          ]}
        />
        {list.isPending ? <Skeleton className="h-24 w-full rounded-card" /> : null}
        {list.isError ? <LoadError onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.length === 0 ? <EmptyState title={t(status === "pending" ? "hr.leave.noneWaiting" : "hr.leave.none")} /> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(list.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border p-3">
              <div className="min-w-0">
                <p className="m-0 text-[14px] font-semibold">
                  <Link to={"/hr/$id" as never} params={{ id: r.employeeId } as never} className="underline-offset-4 hover:underline">
                    {r.name}
                  </Link>{" "}
                  <span className="font-mono text-xs font-normal text-muted-foreground">{r.code}</span>
                </p>
                <p className="m-0 text-[13px]">
                  {r.kindName} · {r.fromDay === r.toDay ? bookDateText(fmt, r.fromDay) : t("hr.leave.range", { from: bookDateText(fmt, r.fromDay), to: bookDateText(fmt, r.toDay) })} · {t("hr.leave.days", { days: halvesToDays(r.halves), count: r.halves / 2 })}
                </p>
                {r.reason ? <p className="m-0 text-xs text-muted-foreground">{r.reason}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <Chip tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : "neutral"} truncate={false}>
                  {t(`hr.leave.status.${r.status}`)}
                </Chip>
                <Can do="leave.approve">
                  {r.status === "pending" || r.status === "approved" ? (
                    <Button variant="secondary" size="sm" loading={cancel.isPending && cancel.variables?.id === r.id} onClick={() => cancel.mutate({ id: r.id })}>
                      {t("hr.leave.cancel")}
                    </Button>
                  ) : null}
                </Can>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <KindsSection />
      <ApplySheet open={applying} onOpenChange={setApplying} />
    </HrGate>
  );
}

function ApplySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const today = useToday();
  const people = useQuery({ ...trpc.hr.people.options.queryOptions({}), enabled: open });
  const kinds = useQuery({ ...trpc.hr.leave.kinds.queryOptions(), enabled: open });
  const [employeeId, setEmployeeId] = useState("");
  const [kindId, setKindId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployeeId("");
    setKindId("");
    setFrom(today);
    setTo(today);
    setHalf(false);
    setReason("");
    setTried(false);
    // The form restarts at each opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useMutation({
    ...trpc.hr.leave.applyFor.mutationOptions(),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: trpc.hr.leave.pathKey() });
      await qc.invalidateQueries({ queryKey: trpc.approval.pathKey() });
      toast.success(t("hr.leave.applied", { days: halvesToDays(r.halves), count: r.halves / 2 }));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const active = (kinds.data ?? []).filter((k) => k.active);
  const dates = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from && (!half || from === to);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("hr.leave.applyTitle")}
      description={t("hr.leave.applyHint")}
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
              if (!employeeId || !kindId || !dates) return;
              save.mutate({ employeeId, kindId, from, to: half ? from : to, halfDay: half, reason: reason.trim() || null });
            }}
          >
            {t("hr.leave.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("hr.leave.person")} required error={tried && !employeeId ? t("hr.leave.personBad") : undefined}>
          <Pick value={employeeId} onChange={setEmployeeId} options={[{ value: "", label: t("hr.timesheet.pick") }, ...(people.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))]} />
        </Field>
        <Field label={t("hr.leave.kind")} required error={tried && !kindId ? t("hr.leave.kindBad") : undefined}>
          <Pick value={kindId} onChange={setKindId} options={[{ value: "", label: t("hr.leave.kindPick") }, ...active.map((k) => ({ value: k.id, label: `${k.name} (${k.code})` }))]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.leave.from")} required>
            <TextInput
              type="date"
              value={from}
              onChangeText={(v) => {
                setFrom(v);
                if (half || to < v) setTo(v);
              }}
            />
          </Field>
          <Field label={t("hr.leave.to")} required error={tried && !dates ? t("hr.leave.datesBad") : undefined}>
            <TextInput type="date" value={half ? from : to} disabled={half} min={from} onChangeText={setTo} />
          </Field>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="leave-half" checked={half} onCheckedChange={(v) => setHalf(v === true)} />
          <label htmlFor="leave-half" className="text-[14px]">
            {t("hr.leave.halfDay")}
          </label>
        </div>
        <Field label={t("hr.leave.reason")}>
          <TextInput value={reason} onChangeText={setReason} maxLength={300} />
        </Field>
      </div>
    </Sheet>
  );
}

function KindsSection() {
  const { t } = useT();
  const kinds = useQuery(trpc.hr.leave.kinds.queryOptions());
  type Kind = NonNullable<typeof kinds.data>[number];
  const [editing, setEditing] = useState<Kind | "new" | null>(null);
  return (
    <Section
      id="hr-leave-kinds"
      title={t("hr.leave.kindsTitle")}
      hint={t("hr.leave.kindsHint")}
      actions={
        <Can do="hr.manage">
          <Button variant="secondary" onClick={() => setEditing("new")}>
            {t("hr.leave.kindAdd")}
          </Button>
        </Can>
      }
    >
      {kinds.isPending ? <Skeleton className="h-20 w-full rounded-card" /> : null}
      {kinds.isError ? <LoadError onRetry={() => void kinds.refetch()} /> : null}
      {kinds.data && kinds.data.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.leave.kindsNone")}</p> : null}
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {(kinds.data ?? []).map((k) => (
          <li key={k.id} className="flex flex-col gap-1 rounded-card border border-border p-3">
            <p className="m-0 flex items-center justify-between gap-2 text-[14px] font-semibold">
              <span>
                {k.name} <span className="font-mono text-xs text-muted-foreground">{k.code}</span>
              </span>
              <Chip tone={k.active ? (k.paid ? "green" : "neutral") : "neutral"} truncate={false}>
                {!k.active ? t("hr.leave.retired") : k.paid ? t("hr.leave.paid") : t("hr.leave.unpaid")}
              </Chip>
            </p>
            <p className="m-0 text-[13px] text-muted-foreground">{t("hr.leave.kindFigures", { quota: halvesToDays(k.quotaHalves), carry: halvesToDays(k.carryCapHalves) })}</p>
            <Can do="hr.manage">
              <div>
                <Button variant="secondary" size="sm" onClick={() => setEditing(k)}>
                  {t("hr.leave.kindEdit")}
                </Button>
              </div>
            </Can>
          </li>
        ))}
      </ul>
      <KindSheet kind={editing === "new" ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </Section>
  );
}

function KindSheet({ kind, open, onOpenChange }: { kind: { id: string; code: string; name: string; paid: boolean; quotaHalves: number; carryCapHalves: number; active: boolean } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [paid, setPaid] = useState(true);
  const [quota, setQuota] = useState("0");
  const [carry, setCarry] = useState("0");
  const [active, setActive] = useState(true);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(kind?.code ?? "");
    setName(kind?.name ?? "");
    setPaid(kind?.paid ?? true);
    setQuota(kind ? halvesToDays(kind.quotaHalves) : "0");
    setCarry(kind ? halvesToDays(kind.carryCapHalves) : "0");
    setActive(kind?.active ?? true);
    setTried(false);
  }, [open, kind]);

  const save = useMutation({
    ...trpc.hr.leave.saveKind.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.leave.pathKey() });
      toast.success(t("hr.leave.kindSaved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const quotaH = daysToHalves(quota);
  const carryH = daysToHalves(carry);
  const codeOk = /^[A-Za-z]{1,6}$/.test(code.trim());
  const nameOk = name.trim().length > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={kind ? t("hr.leave.kindEditTitle") : t("hr.leave.kindAddTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (!codeOk || !nameOk || quotaH === null || carryH === null || quotaH > 730 || carryH > 730) return;
              save.mutate({ id: kind?.id, code: code.trim(), name: name.trim(), paid, quotaHalves: quotaH, carryCapHalves: carryH, active });
            }}
          >
            {t("hr.leave.kindSave")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.leave.kindCode")} required hint={t("hr.leave.kindCodeHint")} error={tried && !codeOk ? t("hr.leave.kindCodeBad") : undefined}>
            <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} maxLength={6} />
          </Field>
          <Field label={t("hr.leave.kindName")} required error={tried && !nameOk ? t("hr.leave.kindNameBad") : undefined}>
            <TextInput value={name} onChangeText={setName} maxLength={40} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.leave.kindQuota")} hint={t("hr.leave.kindQuotaHint")} error={tried && (quotaH === null || quotaH > 730) ? t("hr.leave.daysBad") : undefined}>
            <NumberInput value={quota} onValueChange={setQuota} />
          </Field>
          <Field label={t("hr.leave.kindCarry")} hint={t("hr.leave.kindCarryHint")} error={tried && (carryH === null || carryH > 730) ? t("hr.leave.daysBad") : undefined}>
            <NumberInput value={carry} onValueChange={setCarry} />
          </Field>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="kind-paid" checked={paid} onCheckedChange={(v) => setPaid(v === true)} />
          <label htmlFor="kind-paid" className="text-[14px]">
            {t("hr.leave.kindPaid")}
          </label>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="kind-active" checked={active} onCheckedChange={(v) => setActive(v === true)} />
          <label htmlFor="kind-active" className="text-[14px]">
            {t("hr.leave.kindActive")}
          </label>
        </div>
      </div>
    </Sheet>
  );
}
