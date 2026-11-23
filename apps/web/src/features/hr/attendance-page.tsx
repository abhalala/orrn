/**
 * `/hr/attendance`: the supervisor's one-screen shift marking, built for a phone on the floor. Pick the day and the
 * shift, give each person a big status button, optionally their in and out times, and save the whole shift once.
 * The server works out worked and overtime minutes from the shift; only times and a status are sent.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useFmt } from "@/shared/lib/fmt";
import { wallParts } from "@/shared/lib/plant-calendar";
import { trpc } from "@/shared/utils/trpc";

import {
  addDaysYmd,
  badTimes,
  canSaveDay,
  dayState,
  draftChanged,
  draftsFromRows,
  hoursMinutes,
  isHhmm,
  markAllPresent,
  markCounts,
  markPayload,
  MARK_STATUSES,
  setStatus,
  type Drafts,
  type SheetRow,
} from "./model";
import { HrGate, HrTabs, LoadError, errorText, useCan, usePlantShifts, useToday } from "./ui";

const ALL = "all";

export function AttendancePage() {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const today = useToday();
  const shifts = usePlantShifts();
  const canManage = useCan("attendance.manage");
  const [day, setDay] = useState(today);
  const [shiftKey, setShiftKey] = useState<string>(shifts[0]?.id ?? ALL);
  const [drafts, setDrafts] = useState<Drafts>({});
  const shiftId = shiftKey === ALL ? null : shiftKey;

  const timeOf = useCallback(
    (at: Date | string | null | undefined) => {
      if (!at) return "";
      const p = wallParts(new Date(at), fmt.zone);
      return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
    },
    [fmt.zone],
  );

  const state = dayState(day, today);
  const q = useQuery({ ...trpc.hr.attendance.shift.queryOptions({ day, shiftId }), enabled: state !== "bad" && state !== "future" });
  const rows = useMemo<SheetRow[]>(() => q.data?.rows ?? [], [q.data]);

  // The draft starts from what the server holds: for a new day or shift, and after a save. A refetch that arrives while
  // marks are typed (the window came back into focus) never throws them away.
  const dirty = useRef(false);
  const reload = useRef(false);
  const loadedKey = useRef("");
  const key = `${day}|${shiftKey}`;
  useEffect(() => {
    if (!q.data) return;
    if (loadedKey.current !== key || reload.current || !dirty.current) {
      setDrafts(draftsFromRows(q.data.rows, timeOf));
      reload.current = false;
    }
    loadedKey.current = key;
  }, [q.data, timeOf, key]);

  const save = useMutation({
    ...trpc.hr.attendance.markShift.mutationOptions(),
    onSuccess: async (r) => {
      reload.current = true;
      await qc.invalidateQueries({ queryKey: trpc.hr.attendance.pathKey() });
      toast.success(t(r.lateEntry ? "hr.attendance.savedLate" : "hr.attendance.saved", { count: r.marked }));
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  const counts = markCounts(rows, drafts);
  const changed = q.data ? draftChanged(rows, drafts, timeOf) : false;
  dirty.current = changed;
  const bad = badTimes(rows, drafts);
  const payload = markPayload(rows, drafts);
  const allowed = canSaveDay(state, canManage);

  function leave(next: () => void) {
    if (changed && !window.confirm(t("hr.attendance.discard"))) return;
    next();
  }

  return (
    <HrGate needs={["hr.view", "attendance.mark"]}>
      <PageHeader title={t("hr.attendance.title")} subtitle={t("hr.attendance.subtitle")} back={{ to: "/hr", label: t("hr.title") }} />
      <HrTabs current="attendance" />

      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2 sm:max-w-xl">
          <Field label={t("hr.attendance.day")}>
            <TextInput type="date" value={day} max={today} onChangeText={(v) => leave(() => setDay(v))} />
          </Field>
          <Button variant="secondary" className="h-12 sm:h-11" onClick={() => leave(() => setDay(today))}>
            {t("hr.attendance.today")}
          </Button>
          <Button variant="secondary" className="h-12 sm:h-11" onClick={() => leave(() => setDay(addDaysYmd(today, -1)))}>
            {t("hr.attendance.yesterday")}
          </Button>
        </div>
        {shifts.length > 0 ? (
          <SegmentedControl
            label={t("hr.attendance.shift")}
            value={shiftKey}
            onChange={(v) => leave(() => setShiftKey(v))}
            options={[...shifts.map((s) => ({ value: s.id, label: s.name })), { value: ALL, label: t("hr.attendance.everyone") }]}
          />
        ) : null}
      </div>

      {state === "late" ? (
        <p role="status" className="m-0 rounded-card border border-border bg-surface-sunken p-3 text-[14px]">
          {canManage ? t("hr.attendance.lateAllowed") : t("hr.attendance.lateBlocked")}
        </p>
      ) : null}
      {state === "future" ? <p role="alert" className="m-0 rounded-card border border-border bg-surface-sunken p-3 text-[14px]">{t("hr.attendance.future")}</p> : null}
      {state === "bad" ? <p role="alert" className="m-0 text-[14px] text-destructive">{t("hr.attendance.dayBad")}</p> : null}

      {q.isPending && state !== "future" && state !== "bad" ? <Skeleton className="h-64 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && rows.length === 0 ? <EmptyState title={t("hr.attendance.empty")} /> : null}

      {rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={!allowed || counts.unmarked === 0}
              onClick={() => setDrafts((d) => markAllPresent(rows, d))}
            >
              {t("hr.attendance.markAll")}
            </Button>
            <p className="m-0 text-[13px] text-muted-foreground" aria-live="polite">
              {t("hr.attendance.counts", { present: counts.present, absent: counts.absent, half: counts.half_day, other: counts.leave + counts.weekly_off + counts.holiday, left: counts.unmarked })}
            </p>
          </div>
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t("hr.attendance.listLabel")}>
            {rows.map((r) => (
              <PersonMark key={r.employeeId} row={r} draft={drafts[r.employeeId]} disabled={!allowed} onStatus={(s) => setDrafts((d) => setStatus(d, r.employeeId, s))} onTime={(k, v) => setDrafts((d) => ({ ...d, [r.employeeId]: { ...(d[r.employeeId] ?? { status: null, inTime: "", outTime: "" }), [k]: v } }))} />
            ))}
          </ul>
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {bad.length > 0 ? <p role="alert" className="m-0 text-[13px] text-destructive">{t("hr.attendance.timesBad")}</p> : null}
            {!allowed && state === "late" ? <p className="m-0 text-[13px] text-muted-foreground">{t("hr.attendance.lateBlocked")}</p> : null}
            <Button
              className="h-14 w-full text-[17px]"
              loading={save.isPending}
              disabled={!allowed || payload.length === 0 || bad.length > 0 || !changed}
              onClick={() => save.mutate({ day, shiftId, rows: payload })}
            >
              {t("hr.attendance.save", { count: payload.length })}
            </Button>
          </div>
        </>
      ) : null}
    </HrGate>
  );
}

function PersonMark({ row, draft, disabled, onStatus, onTime }: { row: SheetRow; draft: Drafts[string] | undefined; disabled: boolean; onStatus: (s: (typeof MARK_STATUSES)[number]) => void; onTime: (k: "inTime" | "outTime", v: string) => void }) {
  const { t } = useT();
  const status = draft?.status ?? null;
  const worked = status === "present" || status === "half_day";
  const mark = row.mark;
  const ot = mark && mark.overtimeMin > 0 ? hoursMinutes(mark.overtimeMin) : null;
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 min-w-0 text-[16px] font-semibold">
          {row.name} <span className="font-mono text-xs font-normal text-muted-foreground">{row.code}</span>
        </p>
        <span className="flex flex-wrap items-center gap-1.5">
          {mark?.source === "punch" ? <Chip tone="blue" truncate={false}>{t("hr.attendance.fromPunch")}</Chip> : null}
          {mark?.lateEntry ? <Chip tone="amber" truncate={false}>{t("hr.attendance.lateChip")}</Chip> : null}
          {ot ? <Chip tone="neutral" truncate={false}>{t("hr.attendance.overtime", { h: ot.h, m: ot.m })}</Chip> : null}
          {status === null ? <Chip tone="amber" truncate={false}>{t("hr.attendance.notMarked")}</Chip> : null}
        </span>
      </div>
      <div role="group" aria-label={row.name} className="grid grid-cols-3 gap-2">
        {MARK_STATUSES.map((s) => (
          <Button
            key={s}
            variant={status === s ? (s === "absent" ? "danger" : "primary") : "secondary"}
            className="h-12 px-2 text-[14px]"
            aria-pressed={status === s}
            disabled={disabled}
            onClick={() => onStatus(s)}
          >
            {t(`hr.mark.${s}`)}
          </Button>
        ))}
      </div>
      {worked ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.attendance.in")} error={draft?.inTime && !isHhmm(draft.inTime) ? t("hr.attendance.timeBad") : undefined}>
            <TextInput type="time" value={draft?.inTime ?? ""} disabled={disabled} onChangeText={(v) => onTime("inTime", v)} />
          </Field>
          <Field label={t("hr.attendance.out")} error={draft?.outTime && !isHhmm(draft.outTime) ? t("hr.attendance.timeBad") : undefined}>
            <TextInput type="time" value={draft?.outTime ?? ""} disabled={disabled} onChangeText={(v) => onTime("outTime", v)} />
          </Field>
        </div>
      ) : null}
    </li>
  );
}
