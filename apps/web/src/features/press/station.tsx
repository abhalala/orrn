import { bpPercent1, formatLength, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import type { MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { FieldTextArea as TextArea } from "./textarea";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileImage } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

import { ErrorLines } from "./error-lines";
import { pressErrorText, pressErrorToast, roleCan, useActionKey, useCompanyTimeZone, useHolds } from "./hooks";
import { statusTone } from "./job-card";
import { bannerOf, clockOf, elapsedText, kgFromG, pollIntervalFor, STATION_ACTION, stationActions, type Banner } from "./model";
import { reasonLabel } from "./reason-label";
import { CountingPanel } from "./station-count";
import type { RunDetail } from "./types";

const NONE = "__none";

/**
 * `/press/runs/$id`: the press station, built for the 11 inch tablet. Big type, one obvious button
 * per state. The banner names the state in the plant's words: Queued "Die not issued. Start is
 * locked." (no Start button at all), Die issued, Running, Stopped, Counting, Logged, Voided.
 */
export function StationScreen({ runId }: { runId: string }) {
  const { t } = useT();
  const { unit } = useLengthUnit();
  const tz = useCompanyTimeZone();
  const query = useQuery({
    ...trpc.press.runs.get.queryOptions({ id: runId }),
    refetchInterval: (q) => pollIntervalFor(q.state.data?.run.status),
    meta: INLINE_ERROR_META,
    retry: (count, error) => !isNotFound(error) && count < 2,
  });
  const data = query.data;

  const header = (
    <PageHeader
      title={data ? data.run.number : t("press.console.title")}
      subtitle={data?.line ? `${data.line.code} · ${data.run.sectionCode} ${data.run.sectionName}` : undefined}
      back={{ to: data?.run.pressLineId ? `/press/lines/${data.run.pressLineId}` : "/press", label: data?.line ? t("press.queue.title", { line: data.line.code }) : t("press.title") }}
    />
  );

  if (showsQueryError(query)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={isNotFound(query.error) ? t("press.console.notFound") : t("press.console.loadFailed")}
            action={
              isNotFound(query.error) ? undefined : (
                <Button variant="secondary" onClick={() => void query.refetch()}>
                  {t("press.console.retry")}
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("press.console.loading")}</span>
          <Skeleton className="h-32 rounded-card" />
          <Skeleton className="h-48 rounded-card" />
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <StationBody data={data} unit={unit} tz={tz} />
    </>
  );
}

function StationBody({ data, unit, tz }: { data: RunDetail; unit: LengthUnit; tz: string }) {
  const { t } = useT();
  const status = data.run.status;
  const banner = bannerOf(status);
  const actions = stationActions(status);
  // Remount the stepper per run so its draft belongs to that run only.
  const counting = banner === "counting";
  const downtime =
    banner === "running" || banner === "stopped" || (counting && data.downtime.length > 0) ? (
      <DowntimeCard data={data} tz={tz} canStart={!counting} />
    ) : null;
  return (
    <div className="flex min-w-0 flex-col gap-4 text-[17px] leading-7" data-slot="station" data-status={status}>
      <BannerBlock banner={banner} data={data} tz={tz} actions={actions} />
      {/* While counting, the stepper comes first: it is what the person is here to do. A manager or admin (press.close without press.run) sees it read-only and can log. */}
      {counting ? (
        <Can do={STATION_ACTION.countingPanel} fallback={<p className="m-0 text-[15px] text-muted-foreground">{t("press.console.countingBody")}</p>}>
          <CountingPanel key={data.run.id} data={data} unit={unit} />
        </Can>
      ) : null}
      {counting ? downtime : null}
      <RunCard data={data} unit={unit} tz={tz} />
      {!counting ? downtime : null}
      {banner === "logged" ? <LoggedPanel data={data} unit={unit} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner and the one action per state
// ---------------------------------------------------------------------------

function useRunWrite(runId: string) {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: trpc.press.runs.get.queryKey({ id: runId }) }),
      qc.invalidateQueries({ queryKey: trpc.press.runs.preview.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.press.queue.list.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.press.lines.list.queryKey() }),
    ]);
  };
}

function BannerBlock({ banner, data, tz, actions }: { banner: Banner; data: RunDetail; tz: string; actions: ReturnType<typeof stationActions> }) {
  const { t } = useT();
  const runId = data.run.id;
  const refresh = useRunWrite(runId);
  const [error, setError] = useState<string | null>(null);
  const [handover, setHandover] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const startKey = useActionKey();
  const stopKey = useActionKey();
  const countKey = useActionKey();
  const resumeKey = useActionKey();
  const undoKey = useActionKey();

  const done = (reset: () => void) => async () => {
    reset();
    setError(null);
    await refresh();
  };
  /** The tablet's clock disagreed with the server's: the time is the server's, a supervisor confirms it. */
  const skewNote = (out: object) => {
    if ("timeUnconfirmed" in out && out.timeUnconfirmed === true) toast.warning(t("press.console.errors.timeSkew"));
  };
  const start = useMutation({
    ...trpc.press.runs.start.mutationOptions(),
    onSuccess: async (out) => {
      skewNote(out);
      await done(startKey.reset)();
    },
    onError: (e) => setError(pressErrorText(t, e, "press.console.startFailed")),
  });
  const stop = useMutation({
    ...trpc.press.runs.stop.mutationOptions(),
    onSuccess: async (out) => {
      skewNote(out);
      await done(stopKey.reset)();
    },
    onError: (e) => setError(pressErrorText(t, e, "press.console.stopFailed")),
  });
  const count = useMutation({ ...trpc.press.runs.count.mutationOptions(), onSuccess: done(countKey.reset), onError: (e) => setError(pressErrorText(t, e)) });
  const resume = useMutation({ ...trpc.press.runs.resume.mutationOptions(), onSuccess: done(resumeKey.reset), onError: (e) => setError(pressErrorText(t, e)) });
  const undo = useMutation({ ...trpc.press.runs.undoStart.mutationOptions(), onSuccess: done(undoKey.reset), onError: (e) => setError(pressErrorText(t, e)) });
  const busy = start.isPending || stop.isPending || count.isPending || resume.isPending || undo.isPending;

  const tone = banner === "running" || banner === "logged" ? "green" : banner === "locked" ? "amber" : "blue";
  const title: Record<Banner, MessageKey> = {
    locked: "press.console.startLocked",
    ready: "press.console.readyTitle",
    running: "press.console.status.running",
    stopped: "press.console.stoppedTitle",
    counting: "press.console.countingTitle",
    logged: "press.console.loggedTitle",
    voided: "press.console.voidedTitle",
  };
  const body: Partial<Record<Banner, string>> = {
    locked: t("press.console.lockedBody"),
    ready: t("press.console.readyBody"),
    stopped: t("press.console.stoppedBody"),
    counting: t("press.console.countingBody"),
    logged: data.run.stored.goodG != null ? t("press.console.loggedBody", { good: kgFromG(data.run.stored.goodG), input: kgFromG(data.run.stored.inputG ?? 0) }) : undefined,
    voided: data.run.voidNote ? `${t("press.console.voidedBody")} ${data.run.voidNote}` : t("press.console.voidedBody"),
  };

  return (
    <section role="status" data-banner={banner} aria-label={t(title[banner])} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[22px] font-bold leading-tight">{t(title[banner])}</h2>
        <Chip tone={tone === "green" ? "green" : tone === "amber" ? "amber" : "blue"} truncate={false}>
          {t(`press.console.status.${data.run.status}` as MessageKey)}
        </Chip>
      </div>
      {banner === "running" ? <RunningClock data={data} tz={tz} /> : null}
      {banner === "stopped" ? (
        <p className="m-0 font-mono text-[26px] font-semibold tabular-nums" data-testid="stopped-window">
          {clockOf(data.run.startedAt, tz)} – {clockOf(data.run.stoppedAt, tz)}
        </p>
      ) : null}
      {body[banner] ? <p className="m-0 text-[16px] leading-6 text-muted-foreground">{body[banner]}</p> : null}
      {data.run.purpose === "die_trial" ? <p className="m-0 text-[15px] font-medium">{t("press.console.trialBanner")}</p> : null}
      {data.run.purpose === "sample" ? <p className="m-0 text-[15px] font-medium">{t("press.console.sampleBanner")}</p> : null}
      {data.run.purpose === "other" ? <p className="m-0 text-[15px] font-medium">{t("press.console.otherBanner")}</p> : null}
      {error ? (
        <ErrorLines message={error} className="m-0 text-[15px] font-medium text-destructive" />
      ) : null}
      <FormActions sticky={false} className="max-sm:flex-col max-sm:[&>*]:flex-none sm:justify-start">
        {actions.start ? (
          <Can do={STATION_ACTION.start}>
            <Button size="lg" disabled={busy} aria-busy={start.isPending} onClick={() => start.mutate({ id: runId, clientMutationId: startKey.get(), tappedAt: Date.now() })}>
              {t("press.console.start")}
            </Button>
          </Can>
        ) : null}
        {actions.stop ? (
          <Can do={STATION_ACTION.stop}>
            <Button size="lg" disabled={busy} aria-busy={stop.isPending} onClick={() => stop.mutate({ id: runId, clientMutationId: stopKey.get(), tappedAt: Date.now() })}>
              {t("press.console.stop")}
            </Button>
          </Can>
        ) : null}
        {actions.count ? (
          <Can do={STATION_ACTION.count}>
            <Button size="lg" disabled={busy} aria-busy={count.isPending} onClick={() => count.mutate({ id: runId, clientMutationId: countKey.get() })}>
              {t("press.console.countAndCheck")}
            </Button>
          </Can>
        ) : null}
        {actions.resume ? (
          <Can do={STATION_ACTION.resume}>
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => resume.mutate({ id: runId, clientMutationId: resumeKey.get() })}>
              {t("press.console.resume")}
            </Button>
          </Can>
        ) : null}
        {actions.stop ? (
          <Can do={STATION_ACTION.undoStart}>
            <Button variant="ghost" size="lg" disabled={busy} onClick={() => undo.mutate({ id: runId, clientMutationId: undoKey.get() })}>
              {t("press.console.undoStart")}
            </Button>
          </Can>
        ) : null}
        {actions.handover ? (
          <Can do={STATION_ACTION.handover}>
            <Button variant="secondary" size="lg" onClick={() => setHandover(true)}>
              {t("press.console.handover")}
            </Button>
          </Can>
        ) : null}
        {actions.void ? (
          <Can do={STATION_ACTION.void}>
            <Button variant="ghost" size="lg" onClick={() => setVoiding(true)}>
              {t("press.console.voidRun")}
            </Button>
          </Can>
        ) : null}
      </FormActions>
      {handover ? <HandoverDialog data={data} onClose={() => setHandover(false)} onSaved={refresh} /> : null}
      {voiding ? <VoidDialog data={data} onClose={() => setVoiding(false)} onSaved={refresh} /> : null}
    </section>
  );
}

function RunningClock({ data, tz }: { data: RunDetail; tz: string }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const startedMs = data.run.startedAt ? new Date(data.run.startedAt).getTime() : null;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-[15px] font-medium text-muted-foreground" data-testid="started-at">
        {t("press.console.startedAt", { time: clockOf(data.run.startedAt, tz) })}
      </p>
      <p className="m-0 font-mono text-[44px] font-semibold leading-none tabular-nums" aria-live="off" data-testid="elapsed">
        {startedMs ? elapsedText(now - startedMs) : "00:00"}
      </p>
      <p className="m-0 text-[13px] text-muted-foreground">{t("press.console.serverTimeNote")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The run card: who, what, which orders
// ---------------------------------------------------------------------------

function RunCard({ data, unit, tz }: { data: RunDetail; unit: LengthUnit; tz: string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [drawingNote, setDrawingNote] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const run = data.run;
  const shifts = ((me?.company?.settings as { shifts?: { id: string; name: string }[] } | undefined)?.shifts ?? []) as { id: string; name: string }[];
  const shiftName = shifts.find((s) => s.id === run.shiftId)?.name ?? (run.shiftSeq ? String(run.shiftSeq) : null);

  const openDrawing = async () => {
    setOpening(true);
    setDrawingNote(null);
    try {
      const out = await qc.fetchQuery({ ...trpc.press.runs.drawing.queryOptions({ id: run.id }), staleTime: 0 });
      if (out.url) window.open(out.url, "_blank", "noopener");
      else setDrawingNote(t("press.console.drawingNone"));
    } catch (e) {
      setDrawingNote(pressErrorToast(t, e));
    } finally {
      setOpening(false);
    }
  };

  const purpose = run.purpose !== "production" ? (`press.plan.purpose.${run.purpose}` as MessageKey) : null;
  return (
    <Card className="gap-4" data-slot="run-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[18px] font-semibold">
            <span className="font-mono">{run.sectionCode}</span> <span className="font-normal text-muted-foreground">{run.sectionName}</span>
          </p>
          <p className="m-0 text-[15px] text-muted-foreground">
            {data.copy ? (
              <>
                {t("press.console.dieCopy")} <span className="font-mono text-foreground">{data.copy.code}</span>
                {data.copy.bolster ? ` · ${t("press.console.bolster", { no: data.copy.bolster })}` : ""}
              </>
            ) : (
              t("press.console.dieNone")
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {purpose ? (
            <Chip tone="neutral" truncate={false}>
              {t(purpose)}
            </Chip>
          ) : null}
          {run.urgent ? (
            <Chip tone="red" truncate={false}>
              {t("press.console.urgent")}
            </Chip>
          ) : null}
          {run.lateEntry ? (
            <Chip tone="amber" truncate={false}>
              {t("press.console.lateBadge")}
            </Chip>
          ) : null}
          {run.timeUnconfirmed ? (
            <Chip tone="amber" truncate={false}>
              {t("press.console.timeUnconfirmed")}
            </Chip>
          ) : null}
        </div>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact label={t("press.console.operator")} value={run.operatorName} />
        <Fact label={t("press.console.relief")} value={run.reliefOperatorName} />
        <Fact label={t("press.console.supervisor")} value={run.supervisorName} />
        {run.productionDay ? <Fact label={t("press.console.shift")} value={shiftName ? keepTogether(t("press.console.shiftLine", { shift: shiftName, day: run.productionDay }), run.productionDay) : keepTogether(run.productionDay, run.productionDay)} /> : null}
        {run.castNumber ? <Fact label={t("press.console.cast")} value={run.castNumber} mono /> : null}
        {run.startedAt ? <Fact label={t("press.console.startedAt", { time: "" }).trim()} value={clockOf(run.startedAt, tz)} mono /> : null}
      </dl>

      {data.planLines.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5" data-slot="released">
          <p className="m-0 text-xs font-medium text-muted-foreground">{t("press.console.released")}</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {data.planLines.map((l) => (
              <li key={l.id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-[15px]">
                <span className="min-w-0 flex-1 basis-[11rem]">
                  <span className="font-mono font-semibold">{l.orderNumber}</span> <span className="text-muted-foreground">{l.customerName}</span>
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {formatLength(l.cutLengthMm, unit)} × {l.pcs} {t("units.pcs")} · {kgFromG(l.kgG)} {t("units.kg")}
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 border-t border-border pt-2 text-[15px] font-semibold tabular-nums">
            {t("press.console.totalLine", { pcs: data.planTotals.pcs, kg: kgFromG(data.planTotals.kgG) })}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {run.hasDrawing ? (
          <Button variant="secondary" size="md" onClick={() => void openDrawing()} disabled={opening}>
            <FileImage aria-hidden="true" className="size-4" />
            {t("press.console.drawing")}
          </Button>
        ) : (
          <span className="text-[14px] text-muted-foreground">{t("press.console.drawingNone")}</span>
        )}
        {drawingNote ? (
          <span role="status" className="text-[14px] text-muted-foreground">
            {drawingNote}
          </span>
        ) : null}
      </div>
      {run.pressRemark || run.dieRemark ? (
        <div className="flex flex-col gap-1 text-[15px]">
          {run.pressRemark ? (
            <p className="m-0">
              <span className="text-muted-foreground">{t("press.console.pressRemark")}: </span>
              {run.pressRemark}
            </p>
          ) : null}
          {run.dieRemark ? (
            <p className="m-0">
              <span className="text-muted-foreground">{t("press.console.dieRemark")}: </span>
              {run.dieRemark}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** `text` with `token` (a date) kept on one line, so "2026-10-24" never breaks at its hyphens. */
function keepTogether(text: string, token: string): ReactNode {
  const at = text.indexOf(token);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="whitespace-nowrap">{token}</span>
      {text.slice(at + token.length)}
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`m-0 mt-0.5 break-words text-[15px] tabular-nums ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function VoidDialog({ data, onClose, onSaved }: { data: RunDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useT();
  const reasons = useQuery(trpc.press.reasons.queryOptions({ kind: "void" }));
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pick = (reasons.data ?? []).find((r) => r.id === reasonId);
  const voidRun = useMutation({
    ...trpc.press.runs.void.mutationOptions(),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: (e) => setError(pressErrorText(t, e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !voidRun.isPending) onClose();
      }}
      title={t("press.console.voidRun")}
      description={t("press.console.voidWhy")}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={voidRun.isPending}>
            {t("press.console.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={voidRun.isPending}
            onClick={() => {
              if (!reasonId) return setError(t("press.console.pickOne"));
              if (pick && (pick.requiresNote || pick.code === "other") && !note.trim()) return setError(t("press.console.noteRequired"));
              voidRun.mutate({ id: data.run.id, reasonCodeId: reasonId, ...(note.trim() ? { note: note.trim() } : {}) });
            }}
          >
            {t("press.console.voidRun")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("press.console.reason")}>
          <Select
            value={reasonId}
            onValueChange={setReasonId}
            placeholder={t("press.console.pickOne")}
            options={(reasons.data ?? []).map((r) => ({ value: r.id, label: reasonLabel(t, "void", r.code, r.label) }))}
          />
        </Field>
        <Field label={t("press.console.downtimeNote")}>
          <TextArea value={note} onChangeText={setNote} rows={2} maxLength={500} />
        </Field>
        {error ? <ErrorLines message={error} className="m-0 text-[14px] font-medium text-destructive" /> : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Handover (relief operator) and downtime
// ---------------------------------------------------------------------------

function HandoverDialog({ data, onClose, onSaved }: { data: RunDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useT();
  const holds = useHolds();
  const members = useQuery(trpc.company.membersList.queryOptions());
  const [operatorId, setOperatorId] = useState(data.run.operatorId ?? NONE);
  const [reliefId, setReliefId] = useState(data.run.reliefOperatorId ?? NONE);
  const [supervisorId, setSupervisorId] = useState(data.run.supervisorId ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    ...trpc.press.runs.handover.mutationOptions(),
    onSuccess: async () => {
      await onSaved();
      toast.success(t("press.console.handoverDone"));
      onClose();
    },
    onError: (e) => setError(pressErrorText(t, e)),
  });
  const rows = members.data ?? [];
  const person = (m: (typeof rows)[number]) => ({ value: m.userId, label: m.user?.name ?? m.user?.email ?? m.userId });
  const crew = [{ value: NONE, label: t("press.console.handoverNobody") }, ...rows.filter((m) => roleCan(m.role, "press.run")).map(person)];
  const bosses = [{ value: NONE, label: t("press.console.handoverNobody") }, ...rows.filter((m) => roleCan(m.role, "press.close")).map(person)];
  const orNull = (v: string) => (v === NONE ? null : v);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !save.isPending) onClose();
      }}
      title={t("press.console.handover")}
      description={t("press.console.handoverBody")}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t("press.console.cancel")}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                id: data.run.id,
                operatorId: orNull(operatorId),
                reliefOperatorId: orNull(reliefId),
                ...(holds.close ? { supervisorId: orNull(supervisorId) } : {}),
              })
            }
          >
            {t("press.console.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("press.console.operator")}>
          <Select value={operatorId} onValueChange={setOperatorId} options={crew} />
        </Field>
        <Field label={t("press.console.handoverRelief")}>
          <Select value={reliefId} onValueChange={setReliefId} options={crew} />
        </Field>
        <Can do="press.close">
          <Field label={t("press.console.handoverSupervisor")}>
            <Select value={supervisorId} onValueChange={setSupervisorId} options={bosses} />
          </Field>
        </Can>
        {error ? <ErrorLines message={error} className="m-0 text-[14px] font-medium text-destructive" /> : null}
      </div>
    </Dialog>
  );
}

function DowntimeCard({ data, tz, canStart }: { data: RunDetail; tz: string; canStart: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const refresh = useRunWrite(data.run.id);
  const reasons = useQuery(trpc.press.reasons.queryOptions({ kind: "downtime" }));
  const [open, setOpen] = useState(false);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const start = useMutation({
    ...trpc.press.downtime.start.mutationOptions(),
    onSuccess: async () => {
      setOpen(false);
      setNote("");
      setReasonId("");
      setError(null);
      await refresh();
      void qc.invalidateQueries({ queryKey: trpc.press.downtime.list.queryKey() });
    },
    onError: (e) => setError(pressErrorText(t, e)),
  });
  const stop = useMutation({
    ...trpc.press.downtime.stop.mutationOptions(),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (e) => setError(pressErrorText(t, e)),
  });
  const rows = data.downtime;
  const openRow = rows.find((r) => !r.stoppedAt);
  const pick = (reasons.data ?? []).find((r) => r.id === reasonId);
  const label = (code: string, text: string) => reasonLabel(t, "downtime", code, text);
  const minutes = (r: (typeof rows)[number]) => Math.max(0, Math.round(((r.stoppedAt ? new Date(r.stoppedAt).getTime() : Date.now()) - new Date(r.startedAt).getTime()) / 60_000));

  return (
    <Card className="gap-3" data-slot="downtime">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[17px] font-semibold">{t("press.console.downtime")}</h2>
        <Can do={STATION_ACTION.downtime}>
          {openRow ? (
            <Button variant="secondary" size="md" disabled={stop.isPending} onClick={() => stop.mutate({ id: openRow.id })}>
              {t("press.console.downtimeStop")}
            </Button>
          ) : canStart ? (
            <Button variant="secondary" size="md" onClick={() => { setError(null); setOpen(true); }}>
              {t("press.console.downtimeStart")}
            </Button>
          ) : null}
        </Can>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-[15px] text-muted-foreground">{t("press.console.downtimeNone")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((r) => (
            <li key={r.id} data-open={!r.stoppedAt} className="flex flex-wrap items-baseline justify-between gap-2 text-[15px]">
              <span className="font-medium">{label(r.reasonCode ?? "other", r.reasonLabel ?? "")}</span>
              <span className="tabular-nums text-muted-foreground">
                {r.stoppedAt ? t("press.console.downtimeMin", { min: minutes(r) }) : t("press.console.downtimeSince", { time: clockOf(r.startedAt, tz) })}
              </span>
              {r.note ? <span className="basis-full text-[14px] text-muted-foreground">{r.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {error && !open ? <ErrorLines message={error} className="m-0 text-[14px] font-medium text-destructive" /> : null}
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!start.isPending) setOpen(o);
        }}
        dismissible={!start.isPending}
        title={t("press.console.downtimeStart")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={start.isPending}>
              {t("press.console.cancel")}
            </Button>
            <Button
              disabled={start.isPending}
              onClick={() => {
                if (!reasonId) return setError(t("press.console.pickOne"));
                if (pick && (pick.requiresNote || pick.code === "other") && !note.trim()) return setError(t("press.console.noteRequired"));
                start.mutate({ pressLineId: data.run.pressLineId!, pressRunId: data.run.id, reasonCodeId: reasonId, ...(note.trim() ? { note: note.trim() } : {}) });
              }}
            >
              {t("press.console.downtimeStart")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t("press.console.downtimeReason")}>
            <Select
              value={reasonId}
              onValueChange={setReasonId}
              placeholder={t("press.console.pickOne")}
              options={(reasons.data ?? []).map((r) => ({ value: r.id, label: label(r.code, r.label) }))}
            />
          </Field>
          <Field label={t("press.console.downtimeNote")} hint={pick && (pick.requiresNote || pick.code === "other") ? t("press.console.noteRequired") : undefined}>
            <TextArea value={note} onChangeText={setNote} rows={3} maxLength={500} />
          </Field>
          {error ? <ErrorLines message={error} className="m-0 text-[14px] font-medium text-destructive" /> : null}
        </div>
      </Sheet>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Logged
// ---------------------------------------------------------------------------

function LoggedPanel({ data, unit }: { data: RunDetail; unit: LengthUnit }) {
  const { t } = useT();
  const refresh = useRunWrite(data.run.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reopen = useMutation({
    ...trpc.press.runs.reopen.mutationOptions(),
    onSuccess: async () => {
      setOpen(false);
      setReason("");
      toast.success(t("press.console.reopenSent"));
      await refresh();
    },
    // A refusal worth reading is the reason the server worked out (an ageing row points at the run): quoted.
    onError: (e) => setError(pressErrorText(t, e, undefined, { conflictReason: true })),
  });
  const s = data.run.stored;
  const pending = data.approvals.some((a) => a.kind === "press_reopen" && a.status === "pending");
  return (
    <>
      <Card className="gap-4" data-slot="logged">
        <div>
          <p className="m-0 text-[13px] font-medium text-muted-foreground">{t("press.console.recovery")}</p>
          <p data-testid="logged-recovery" className="m-0 font-display text-[52px] font-extrabold leading-none tabular-nums">
            {s.recoveryBp == null ? "—" : `${bpPercent1(s.recoveryBp)}%`}
          </p>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Fact label={t("press.console.input")} value={s.inputG != null ? `${kgFromG(s.inputG)} ${t("units.kg")}` : null} mono />
          <Fact label={t("press.console.good")} value={s.goodG != null ? `${kgFromG(s.goodG)} ${t("units.kg")}` : null} mono />
          <Fact label={t("press.console.discard")} value={data.run.discardG != null ? `${kgFromG(data.run.discardG)} ${t("units.kg")}` : null} mono />
          <Fact label={t("press.console.ends")} value={data.run.endsG != null ? `${kgFromG(data.run.endsG)} ${t("units.kg")}` : null} mono />
          <Fact label={t("press.console.reject")} value={s.rejectG != null ? `${kgFromG(s.rejectG)} ${t("units.kg")}` : null} mono />
          <Fact label={t("press.console.balanceLabel")} value={s.balanceG != null ? `${kgFromG(s.balanceG)} ${t("units.kg")}` : null} mono />
        </dl>
        {data.lines.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {data.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 text-[15px]">
                <span className="min-w-0 flex-1 basis-[10rem]">
                  {l.orderNumber ? <span className="font-mono font-semibold">{l.orderNumber}</span> : <span className="text-muted-foreground">{t("press.console.noOrderFor")}</span>}
                  {l.customerName ? <span className="text-muted-foreground"> {l.customerName}</span> : null}
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {formatLength(l.cutLengthMm, unit)} × {l.pcs} {t("units.pcs")} · {kgFromG(l.goodG)} {t("units.kg")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {data.run.billetShortReason ? <p className="m-0 text-[14px] leading-6">{data.run.billetShortReason}</p> : null}
        {data.run.trialResult ? (
          <Chip tone={data.run.trialResult === "pass" ? "green" : "red"} truncate={false}>
            {data.run.trialResult === "pass" ? t("press.console.trialPass") : t("press.console.trialFail")}
          </Chip>
        ) : null}
      </Card>
      {pending ? (
        <p role="status" className="m-0 text-[15px] font-medium">
          {t("press.console.reopenPending")}
        </p>
      ) : (
        <Can do={STATION_ACTION.requestReopen}>
          <div>
            <Button variant="secondary" size="lg" onClick={() => { setError(null); setOpen(true); }}>
              {t("press.console.reopenAsk")}
            </Button>
          </div>
        </Can>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!reopen.isPending) setOpen(o);
        }}
        title={t("press.console.reopenAsk")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={reopen.isPending}>
              {t("press.console.cancel")}
            </Button>
            <Button
              disabled={reopen.isPending}
              onClick={() => {
                if (!reason.trim()) return setError(t("press.console.required"));
                reopen.mutate({ id: data.run.id, reason: reason.trim() });
              }}
            >
              {t("press.console.reopenAsk")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t("press.console.reopenWhy")}>
            <TextArea value={reason} onChangeText={setReason} rows={3} maxLength={500} />
          </Field>
          {error ? <ErrorLines message={error} className="m-0 text-[14px] font-medium text-destructive" /> : null}
        </div>
      </Dialog>
    </>
  );
}
