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

import { pressErrorText, roleCan, useActionKey } from "./hooks";
import type { QueueCard } from "./types";

const NONE = "__none";

/** `datetime-local` text → epoch ms in the browser's zone, or null. */
export function localToMs(text: string): number | null {
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : null;
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
    if (start === null || stop === null || !(start < stop)) return setError(t("press.late.order"));
    if (stop > Date.now()) return setError(t("press.late.futureStop"));
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
          <TextInput type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.currentTarget.value)} />
        </Field>
        <Field label={t("press.late.stoppedAt")}>
          <TextInput type="datetime-local" value={stoppedAt} onChange={(e) => setStoppedAt(e.currentTarget.value)} />
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
        {error ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
