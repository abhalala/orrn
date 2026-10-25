import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FieldTextArea as TextArea } from "./textarea";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { ErrorLines } from "./error-lines";
import { pressErrorText, roleCan, useActionKey } from "./hooks";
import { LATE_ENTRY_DAYS, lateEntryIssue } from "./model";
import type { QueueCard } from "./types";

const NONE = "__none";

/** `datetime-local` text → epoch ms in the browser's zone, or null. */
export function localToMs(text: string): number | null {
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** `datetime-local` text for an instant, in the browser's zone. */
export function msToLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Late-entry form for supervisors (rank 40, `press.runs.open`): a run that already stopped and was
 * never entered on the tablet. It lands as a counting run flagged "entered late" with an approval
 * request; the supervisor then counts it and a manager approves before it can be logged.
 */
export function LateEntrySheet({
  open,
  onOpenChange,
  pressLineId,
  queued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pressLineId: string;
  /** The line's waiting runs (a late entry may fill one of them). */
  queued: readonly QueueCard[];
}) {
  const { t } = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = useActionKey();
  const [mode, setMode] = useState<"queue" | "copy">("copy");
  const [runId, setRunId] = useState("");
  const [copyId, setCopyId] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [stoppedAt, setStoppedAt] = useState("");
  const [operatorId, setOperatorId] = useState(NONE);
  const [reliefId, setReliefId] = useState(NONE);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setMode(queued.length > 0 ? "queue" : "copy");
  }, [open, queued.length]);

  // The 7-day rule up front: the pickers stop at the window's edges (the server checks it again).
  const bounds = useMemo(() => {
    const now = Date.now();
    return { min: msToLocal(now - LATE_ENTRY_DAYS * 86_400_000), max: msToLocal(now) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copies = useQuery({ ...trpc.dieInstance.list.queryOptions({ limit: 200 }), enabled: open });
  const members = useQuery({ ...trpc.company.membersList.queryOptions(), enabled: open });
  const copyOptions = useMemo(
    () =>
      (copies.data?.items ?? [])
        .filter((c) => c.status !== "retired")
        .map((c) => ({ value: c.id, label: `${c.code} · ${c.sectionCode}` })),
    [copies.data],
  );
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((m) => roleCan(m.role, "press.run"))
        .map((m) => ({ value: m.userId, label: m.user?.name ?? m.user?.email ?? m.userId })),
    [members.data],
  );
  const personOptions = [{ value: NONE, label: t("press.console.handoverNobody") }, ...people];

  const open_ = useMutation({
    ...trpc.press.runs.open.mutationOptions(),
    onSuccess: (out) => {
      key.reset();
      toast.success(t("press.late.done", { number: out.number }));
      void qc.invalidateQueries({ queryKey: trpc.press.queue.list.queryKey({ pressLineId }) });
      void qc.invalidateQueries({ queryKey: trpc.press.lines.list.queryKey() });
      onOpenChange(false);
      void navigate({ to: `/press/runs/${out.id}` as never });
    },
    onError: (e) => setError(pressErrorText(t, e)),
  });

  const submit = () => {
    setError(null);
    const start = localToMs(startedAt);
    const stop = localToMs(stoppedAt);
    const issue = lateEntryIssue({ startMs: start, stopMs: stop, nowMs: Date.now() });
    if (issue === "order") return setError(t("press.late.order"));
    if (issue === "future") return setError(t("press.late.futureStop"));
    if (issue === "tooOld") return setError(t("press.late.tooOld", { days: LATE_ENTRY_DAYS }));
    if (start === null || stop === null) return setError(t("press.late.order"));
    if (!reason.trim()) return setError(t("common.noteRequired"));
    if (mode === "queue" && !runId) return setError(t("press.late.pickOne"));
    if (mode === "copy" && !copyId) return setError(t("press.late.pickOne"));
    open_.mutate({
      clientMutationId: key.get(),
      ...(mode === "queue" ? { runId } : { pressLineId, dieInstanceId: copyId }),
      startedAt: start,
      stoppedAt: stop,
      ...(operatorId !== NONE ? { operatorId } : {}),
      ...(reliefId !== NONE ? { reliefOperatorId: reliefId } : {}),
      reason: reason.trim(),
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!open_.isPending) onOpenChange(next);
      }}
      dismissible={!open_.isPending}
      title={t("press.late.title")}
      description={t("press.late.body")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={open_.isPending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={open_.isPending}>
            {t("press.late.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p data-slot="late-window" className="m-0 rounded-card bg-surface-sunken p-3 text-[14px] font-medium leading-6">
          {t("press.late.window", { days: LATE_ENTRY_DAYS })}
        </p>
        {queued.length > 0 ? (
          <SegmentedControl
            label={t("press.late.source")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "queue", label: t("press.late.fromQueue") },
              { value: "copy", label: t("press.late.notInQueue") },
            ]}
          />
        ) : null}
        {mode === "queue" ? (
          <Field label={t("press.late.pickRun")}>
            <Select
              value={runId}
              onValueChange={setRunId}
              placeholder={t("press.late.pickOne")}
              options={queued.map((c) => ({ value: c.id, label: `${c.number} · ${c.sectionCode}` }))}
            />
          </Field>
        ) : (
          <Field label={t("press.late.pickCopy")}>
            <Select value={copyId} onValueChange={setCopyId} placeholder={t("press.late.pickOne")} options={copyOptions} />
          </Field>
        )}
        <Field label={t("press.late.startedAt")}>
          <TextInput type="datetime-local" value={startedAt} min={bounds.min} max={bounds.max} onChange={(e) => setStartedAt(e.currentTarget.value)} />
        </Field>
        <Field label={t("press.late.stoppedAt")}>
          <TextInput type="datetime-local" value={stoppedAt} min={bounds.min} max={bounds.max} onChange={(e) => setStoppedAt(e.currentTarget.value)} />
        </Field>
        <Field label={t("press.late.operator")}>
          <Select value={operatorId} onValueChange={setOperatorId} options={personOptions} />
        </Field>
        <Field label={t("press.late.relief")}>
          <Select value={reliefId} onValueChange={setReliefId} options={personOptions} />
        </Field>
        <Field label={t("press.late.reason")}>
          <TextArea value={reason} onChangeText={setReason} rows={3} maxLength={500} />
        </Field>
        {error ? <ErrorLines message={error} className="m-0 text-[14px] font-medium text-destructive" /> : null}
      </div>
    </Sheet>
  );
}
