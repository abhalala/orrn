import { bpPercent1, formatLength, parseDecimal, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import type { MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { FieldTextArea as TextArea } from "./textarea";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { Stepper } from "@orrn/ui/components/stepper";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { clearDraft, emptyBillet, emptyCut, emptyQc, textToLength, useCountDraft } from "./count-draft";
import { gatesOf, pressErrorText, useActionKey } from "./hooks";
import {
  billetRows,
  COUNT_STEPS,
  gateSentences,
  isLastStep,
  kgFromG,
  kgTextToG,
  lineRows,
  qcRows,
  stepOfGate,
} from "./model";
import { reasonLabel } from "./reason-label";
import type { RunDetail } from "./types";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const unitSuffix = (unit: LengthUnit) => (unit === "inch" ? "in" : "mm");

/**
 * The counting stepper (spec E3): billets, pieces, butt and ends, rejects, remark and reading. Each
 * step saves to the server when the person moves on; the preview beside it is the server's
 * (`press.runs.preview`, "not saved"); Log run is offered to press.close holders only. Nothing the
 * person typed is cleared when a save fails: the message says so and the same button tries again.
 */
export function CountingPanel({ data, unit, canClose }: { data: RunDetail; unit: LengthUnit; canClose: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const runId = data.run.id;
  const { draft, patch, setDraft } = useCountDraft(runId, data, unit);
  const toMm = (text: string) => textToLength(text, unit);
  const closeKey = useActionKey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);
  const [gates, setGates] = useState<string[] | null>(null);
  const [refusedShort, setRefusedShort] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const casts = useQuery(trpc.foundry.casts.list.queryOptions({ limit: 200 }));
  const rejectReasons = useQuery(trpc.press.reasons.queryOptions({ kind: "qc_reject" }));
  const reason = useDebounced(draft.billetShortReason.trim(), 400);
  const preview = useQuery({
    ...trpc.press.runs.preview.queryOptions({
      id: runId,
      ...(reason ? { billetShortReason: reason } : {}),
      ...(draft.trialResult ? { trialResult: draft.trialResult } : {}),
    }),
    placeholderData: keepPreviousData,
  });

  const billets = useMutation(trpc.press.runs.billets.mutationOptions());
  const lines = useMutation(trpc.press.runs.lines.mutationOptions());
  const scrap = useMutation(trpc.press.runs.scrap.mutationOptions());
  const qcMut = useMutation(trpc.press.runs.qc.mutationOptions());
  const remark = useMutation(trpc.press.runs.remark.mutationOptions());
  const reading = useMutation(trpc.dieInstance.addReading.mutationOptions());
  const close = useMutation(trpc.press.runs.close.mutationOptions());
  const confirmTime = useMutation(trpc.press.runs.confirmTime.mutationOptions());

  // A refused close stays on screen until the figures change (the person fixed something).
  useEffect(() => {
    setGates(null);
  }, [preview.dataUpdatedAt]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: trpc.press.runs.get.queryKey({ id: runId }) }),
      qc.invalidateQueries({ queryKey: trpc.press.runs.preview.queryKey() }),
    ]);
  };

  const castOptions = useMemo(
    () =>
      (casts.data?.items ?? [])
        .filter((c) => c.billetsOnHandG > 0 || c.id === draft.castId)
        .sort((a, b) => b.billetsOnHandG - a.billetsOnHandG)
        .map((c) => ({
          value: c.id,
          label: `${c.number} · ${t("press.console.castOnHand", { kg: kgFromG(c.billetsOnHandG) })}${c.billetsShortG > 0 ? ` · ${t("press.console.billetsShortBy", { kg: kgFromG(c.billetsShortG) })}` : ""}`,
        })),
    [casts.data, draft.castId, t],
  );

  const fail = (e: unknown, retry: () => void) => {
    setError({ message: pressErrorText(t, e), retry });
    return false;
  };
  const invalid = (key: MessageKey) => {
    setError({ message: t(key) });
    return false;
  };

  /** Save one step's entries. True when the server has them (or there was nothing to send). */
  const saveStep = async (step: number): Promise<boolean> => {
    setError(null);
    setNotice(null);
    const again = () => void next();
    try {
      if (step === 0) {
        if (!draft.castId) return invalid("press.console.gates.no_cast");
        const r = billetRows(draft.billets, toMm);
        if ("issue" in r) return invalid("press.console.gates.billet_row_invalid");
        if (r.rows.length === 0) return invalid("press.console.gates.no_billets");
        await billets.mutateAsync({ id: runId, castId: draft.castId, rows: r.rows });
      } else if (step === 1) {
        const r = lineRows(draft.lines, toMm);
        if ("issue" in r) return invalid("press.console.gates.line_invalid");
        if (r.rows.length === 0) return invalid("press.console.gates.no_lines");
        const pressed = draft.pressedLengthText.trim() === "" ? null : toMm(draft.pressedLengthText);
        if (draft.pressedLengthText.trim() !== "" && pressed === null) return invalid("press.console.gates.line_invalid");
        await lines.mutateAsync({ id: runId, rows: r.rows });
        await scrap.mutateAsync({ id: runId, pressedLengthMm: pressed });
      } else if (step === 2) {
        const d = draft.discardText.trim() === "" ? null : kgTextToG(draft.discardText);
        const e = draft.endsText.trim() === "" ? null : kgTextToG(draft.endsText);
        if ((draft.discardText.trim() !== "" && d === null) || (draft.endsText.trim() !== "" && e === null)) return invalid("press.console.gates.no_input");
        await scrap.mutateAsync({ id: runId, discardG: d, endsG: e });
      } else if (step === 3) {
        const r = qcRows(draft.qc);
        if ("issue" in r) return invalid("press.console.gates.qc_row_invalid");
        if (r.rows.length === 0) return invalid("press.console.gates.no_qc");
        await qcMut.mutateAsync({ id: runId, rows: r.rows });
      }
      await refresh();
      return true;
    } catch (e) {
      return fail(e, again);
    }
  };

  const next = async () => {
    setBusy(true);
    const ok = await saveStep(draft.step);
    setBusy(false);
    if (ok) patch({ step: Math.min(draft.step + 1, COUNT_STEPS.length - 1) });
  };

  /** The last step's remark and reading. */
  const saveNotes = async (): Promise<boolean> => {
    setError(null);
    try {
      const press = draft.pressRemark.trim();
      if (press && press !== (data.run.pressRemark ?? "")) await remark.mutateAsync({ id: runId, kind: "press", body: press });
      const dieText = draft.dieRemark.trim();
      if (dieText && data.copy && dieText !== (data.run.dieRemark ?? "")) await remark.mutateAsync({ id: runId, kind: "die", body: dieText });
      if (draft.readingText.trim() !== "" && data.copy) {
        const kg = parseDecimal(draft.readingText);
        if (kg === null || kg <= 0) return invalid("press.console.gates.line_invalid");
        await reading.mutateAsync({ dieInstanceId: data.copy.id, pressRunId: runId, kgPer12ftMilli: Math.round(kg * 1000) });
        patch({ readingText: "" });
        setNotice(t("press.console.readingSaved"));
        void qc.invalidateQueries({ queryKey: trpc.press.runs.get.queryKey({ id: runId }) });
      }
      return true;
    } catch (e) {
      return fail(e, () => void saveNotesClick());
    }
  };
  const saveNotesClick = async () => {
    setBusy(true);
    const ok = await saveNotes();
    setBusy(false);
    if (ok) await refresh();
  };

  const logRun = async () => {
    setBusy(true);
    setGates(null);
    setNotice(null);
    const ok = await saveNotes();
    if (!ok) return setBusy(false);
    try {
      const out = await close.mutateAsync({
        id: runId,
        clientMutationId: closeKey.get(),
        ...(draft.billetShortReason.trim() ? { billetShortReason: draft.billetShortReason.trim() } : {}),
        ...(draft.trialResult ? { trialResult: draft.trialResult } : {}),
      });
      closeKey.reset();
      clearDraft(runId);
      toast.success(t("press.console.loggedDone", { pct: out.recoveryBp == null ? "" : bpPercent1(out.recoveryBp) }));
      await qc.invalidateQueries({ queryKey: trpc.press.queue.list.queryKey() });
      await qc.invalidateQueries({ queryKey: trpc.press.lines.list.queryKey() });
      await refresh();
    } catch (e) {
      const refused = gatesOf(e);
      if (refused) {
        if (refused.includes("billet_short_reason_missing")) setRefusedShort(true);
        setGates(refused);
        setError(null);
      } else {
        fail(e, () => void logRun());
      }
    } finally {
      setBusy(false);
    }
  };

  const figures = preview.data?.figures;
  const liveGates = (preview.data?.gates ?? []).filter((g) => canClose || (g !== "no_close_permission" && g !== "not_supervisor"));
  const shownGates = liveGates;
  const stepLabels = COUNT_STEPS.map((s) => t(`press.console.steps.${s}` as MessageKey));
  const last = isLastStep(draft.step);
  const warnPct = (() => {
    const bp = (me?.company?.settings as { press?: { balanceWarnBp?: number } } | undefined)?.press?.balanceWarnBp;
    return (typeof bp === "number" ? bp : 200) / 100;
  })();

  return (
    <div className="flex min-w-0 flex-col gap-4" data-slot="counting" data-step={draft.step}>
      <Stepper steps={stepLabels} current={draft.step} />

      {draft.step === 0 ? (
        <Card className="gap-4">
          <Field label={t("press.console.castPick")}>
            <Select
              value={draft.castId}
              onValueChange={(castId) => patch({ castId })}
              placeholder={casts.data && castOptions.length === 0 ? t("press.console.castNone") : t("press.console.pickOne")}
              options={castOptions}
            />
          </Field>
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("press.console.billetsOnce")}</p>
          {draft.billets.map((row, i) => (
            <div key={row.key} className="grid grid-cols-1 gap-3 rounded-card bg-surface-sunken p-3 sm:grid-cols-3">
              <Field label={i === 0 ? t("press.console.billetLength") : `${t("press.console.billetLength")} ${i + 1}`}>
                <NumberInput
                  value={row.lengthText}
                  onValueChange={(lengthText) => setDraft((d) => ({ ...d, billets: d.billets.map((b) => (b.key === row.key ? { ...b, lengthText } : b)) }))}
                  suffix={unitSuffix(unit)}
                />
              </Field>
              <Field label={i === 0 ? t("press.console.billetCount") : `${t("press.console.billetCount")} ${i + 1}`}>
                <NumberInput
                  value={row.countText}
                  onValueChange={(countText) => setDraft((d) => ({ ...d, billets: d.billets.map((b) => (b.key === row.key ? { ...b, countText } : b)) }))}
                  decimal={false}
                />
              </Field>
              <Field label={i === 0 ? t("press.console.weighedKg") : `${t("press.console.weighedKg")} ${i + 1}`}>
                <NumberInput
                  value={row.kgText}
                  onValueChange={(kgText) => setDraft((d) => ({ ...d, billets: d.billets.map((b) => (b.key === row.key ? { ...b, kgText } : b)) }))}
                  suffix={t("units.kg")}
                />
              </Field>
              {draft.billets.length > 1 ? (
                <Button variant="ghost" size="md" className="sm:col-span-3" onClick={() => setDraft((d) => ({ ...d, billets: d.billets.filter((b) => b.key !== row.key) }))}>
                  {t("press.console.remove")}
                </Button>
              ) : null}
            </div>
          ))}
          <Button variant="secondary" disabled={draft.billets.length >= 10} onClick={() => setDraft((d) => ({ ...d, billets: [...d.billets, emptyBillet()] }))}>
            {t("press.console.addBillet")}
          </Button>
        </Card>
      ) : null}

      {draft.step === 1 ? (
        <Card className="gap-4">
          {draft.lines.map((row, i) => {
            const saved = data.lines.find((l) => l.pressPlanLineId === row.pressPlanLineId && row.pressPlanLineId);
            const hint = saved?.theoreticalG ?? data.lines[i]?.theoreticalG ?? null;
            return (
              <div key={row.key} className="grid grid-cols-1 gap-3 rounded-card bg-surface-sunken p-3 sm:grid-cols-2" data-slot="cut-row">
                <div className="min-w-0 sm:col-span-2">
                  {row.orderNumber ? (
                    <p className="m-0 font-semibold">
                      <span className="font-mono">{row.orderNumber}</span>
                      {data.planLines.find((p) => p.id === row.pressPlanLineId)?.customerName ? (
                        <span className="font-normal text-muted-foreground"> {data.planLines.find((p) => p.id === row.pressPlanLineId)?.customerName}</span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="m-0 font-semibold">{t("press.console.noOrderFor")}</p>
                  )}
                  {row.releasedPcs !== null ? <p className="m-0 text-[14px] text-muted-foreground">{t("press.console.pcsOrdered", { pcs: row.releasedPcs })}</p> : null}
                </div>
                {row.pressPlanLineId === null && data.planLines.length > 0 ? (
                  <Field label={t("press.console.orderLine")} className="sm:col-span-2">
                    <Select
                      value=""
                      onValueChange={(id) => {
                        const pl = data.planLines.find((p) => p.id === id);
                        if (pl) setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === row.key ? { ...l, pressPlanLineId: pl.id, orderNumber: pl.orderNumber, cutLengthMm: pl.cutLengthMm, releasedPcs: pl.pcs } : l)) }));
                      }}
                      placeholder={t("press.console.pickOne")}
                      options={data.planLines.map((p) => ({ value: p.id, label: `${p.orderNumber} ${p.customerName} · ${formatLength(p.cutLengthMm, unit)}` }))}
                    />
                  </Field>
                ) : null}
                {row.cutLengthMm === null ? (
                  <Field label={t("press.console.cutLength")}>
                    <NumberInput
                      value={row.cutText}
                      onValueChange={(cutText) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === row.key ? { ...l, cutText } : l)) }))}
                      suffix={unitSuffix(unit)}
                    />
                  </Field>
                ) : (
                  <p className="m-0 self-end text-[15px] font-medium tabular-nums">
                    {t("press.console.cutLength")}: {formatLength(row.cutLengthMm, unit)}
                  </p>
                )}
                <Field label={t("press.console.pcs")}>
                  <NumberInput
                    value={row.pcsText}
                    onValueChange={(pcsText) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === row.key ? { ...l, pcsText } : l)) }))}
                    decimal={false}
                  />
                </Field>
                <Field
                  label={t("press.console.good")}
                  hint={hint ? t("press.console.hint", { kg: kgFromG(hint) }) : undefined}
                >
                  <NumberInput
                    value={row.kgText}
                    onValueChange={(kgText) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === row.key ? { ...l, kgText } : l)) }))}
                    suffix={t("units.kg")}
                  />
                </Field>
                {row.pressPlanLineId === null && draft.lines.length > 1 ? (
                  <Button variant="ghost" size="md" className="sm:col-span-2" onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== row.key) }))}>
                    {t("press.console.remove")}
                  </Button>
                ) : null}
              </div>
            );
          })}
          <Button variant="secondary" disabled={draft.lines.length >= 50} onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyCut()] }))}>
            {t("press.console.addLength")}
          </Button>
          <Field label={t("press.console.pressedLength")} hint={t("press.console.pressedLengthHint")}>
            <NumberInput value={draft.pressedLengthText} onValueChange={(pressedLengthText) => patch({ pressedLengthText })} suffix={unitSuffix(unit)} />
          </Field>
        </Card>
      ) : null}

      {draft.step === 2 ? (
        <Card className="gap-4">
          <Field label={t("press.console.discard")} hint={t("press.console.buttHint")}>
            <NumberInput value={draft.discardText} onValueChange={(discardText) => patch({ discardText })} suffix={t("units.kg")} />
          </Field>
          <Field label={t("press.console.ends")} hint={t("press.console.endsHint")}>
            <NumberInput value={draft.endsText} onValueChange={(endsText) => patch({ endsText })} suffix={t("units.kg")} />
          </Field>
        </Card>
      ) : null}

      {draft.step === 3 ? (
        <Card className="gap-4">
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("press.console.rejectsHint")}</p>
          {draft.qc.map((row, i) => {
            const positive = (kgTextToG(row.kgText) ?? 0) > 0 || Number(row.pcsText || 0) > 0;
            const chosen = (rejectReasons.data ?? []).find((r) => r.id === row.reasonCodeId);
            return (
              <div key={row.key} className="grid grid-cols-1 gap-3 rounded-card bg-surface-sunken p-3 sm:grid-cols-2" data-slot="reject-row">
                <Field label={i === 0 ? t("press.console.reject") : `${t("press.console.reject")} ${i + 1}`}>
                  <NumberInput
                    value={row.kgText}
                    onValueChange={(kgText) => setDraft((d) => ({ ...d, qc: d.qc.map((q) => (q.key === row.key ? { ...q, kgText } : q)) }))}
                    suffix={t("units.kg")}
                  />
                </Field>
                <Field label={i === 0 ? t("press.console.rejectPcs") : `${t("press.console.rejectPcs")} ${i + 1}`}>
                  <NumberInput
                    value={row.pcsText}
                    onValueChange={(pcsText) => setDraft((d) => ({ ...d, qc: d.qc.map((q) => (q.key === row.key ? { ...q, pcsText } : q)) }))}
                    decimal={false}
                  />
                </Field>
                {positive ? (
                  <>
                    <Field label={t("press.console.rejectReason")}>
                      <Select
                        value={row.reasonCodeId}
                        onValueChange={(reasonCodeId) => setDraft((d) => ({ ...d, qc: d.qc.map((q) => (q.key === row.key ? { ...q, reasonCodeId } : q)) }))}
                        placeholder={t("press.console.pickOne")}
                        options={(rejectReasons.data ?? []).map((r) => ({ value: r.id, label: reasonLabel(t, "qc_reject", r.code, r.label) }))}
                      />
                    </Field>
                    <Field label={t("press.console.rejectNote")} hint={chosen?.requiresNote ? t("press.console.noteRequired") : undefined}>
                      <TextArea
                        value={row.note}
                        rows={2}
                        maxLength={500}
                        onChangeText={(note) => setDraft((d) => ({ ...d, qc: d.qc.map((q) => (q.key === row.key ? { ...q, note } : q)) }))}
                      />
                    </Field>
                  </>
                ) : null}
                {draft.qc.length > 1 ? (
                  <Button variant="ghost" size="md" className="sm:col-span-2" onClick={() => setDraft((d) => ({ ...d, qc: d.qc.filter((q) => q.key !== row.key) }))}>
                    {t("press.console.remove")}
                  </Button>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDraft((d) => ({ ...d, qc: [...d.qc, emptyQc()] }))}>
              {t("press.console.addReject")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDraft((d) => ({ ...d, qc: [{ key: emptyQc().key, pcsText: "0", kgText: "0", reasonCodeId: "", note: "", runLine: null }] }))}
            >
              {t("press.console.noRejects")}
            </Button>
          </div>
          {draft.qc.length === 1 && draft.qc[0]!.kgText === "0" && draft.qc[0]!.pcsText === "0" ? <Chip tone="green" truncate={false}>{t("press.console.checkedNone")}</Chip> : null}
        </Card>
      ) : null}

      {last ? (
        <Card className="gap-4">
          <Field label={t("press.console.pressRemark")}>
            <TextArea value={draft.pressRemark} rows={2} maxLength={500} onChangeText={(pressRemark) => patch({ pressRemark })} />
          </Field>
          {data.copy ? (
            <Field label={t("press.console.dieRemark")}>
              <TextArea value={draft.dieRemark} rows={2} maxLength={500} onChangeText={(dieRemark) => patch({ dieRemark })} />
            </Field>
          ) : null}
          {data.copy ? (
            <Can do="die.reading">
              <Field
                label={t("press.console.readingTitle")}
                hint={data.copy.kgPer12ftMilli ? t("press.console.readingLast", { kg: (data.copy.kgPer12ftMilli / 1000).toFixed(3) }) : t("press.console.readingNone")}
              >
                <NumberInput value={draft.readingText} onValueChange={(readingText) => patch({ readingText })} suffix={t("press.console.readingLabel")} />
              </Field>
            </Can>
          ) : null}
          {data.run.purpose === "die_trial" ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[13px] font-medium text-muted-foreground">{t("press.console.trialResult")}</p>
              <SegmentedControl
                label={t("press.console.trialResult")}
                value={draft.trialResult || "none"}
                onChange={(v) => patch({ trialResult: v === "none" ? "" : v })}
                options={[
                  { value: "pass", label: t("press.console.trialPass") },
                  { value: "fail", label: t("press.console.trialFail") },
                ]}
              />
            </div>
          ) : null}
          {figures?.short || refusedShort ? (
            <Field label={t("press.console.billetShortReason")} hint={`${t("press.console.shortStock", { kg: kgFromG(preview.data?.billetsOnHandG ?? 0) })}${figures?.billetShortG ? ` ${t("press.console.billetsShortBy", { kg: kgFromG(figures.billetShortG) })}.` : ""}`}>
              <TextArea value={draft.billetShortReason} rows={2} maxLength={500} onChangeText={(billetShortReason) => patch({ billetShortReason })} />
            </Field>
          ) : null}
        </Card>
      ) : null}

      <PreviewPanel
        data={data}
        figures={figures}
        pending={preview.isPending}
        warnPct={warnPct}
        gates={shownGates}
        showGates={last || (gates?.length ?? 0) > 0}
        canClose={canClose}
        t={t}
        onGoto={(step) => patch({ step })}
      />

      {data.run.timeUnconfirmed ? (
        <Card className="gap-2" size="sm">
          <Chip tone="amber" truncate={false}>
            {t("press.console.timeUnconfirmed")}
          </Chip>
          {data.approvals.some((a) => a.kind === "press_time" && a.status === "pending") ? (
            <p className="m-0 text-[14px] text-muted-foreground">{t("press.console.timeAsked")}</p>
          ) : (
            <Button
              variant="secondary"
              disabled={confirmTime.isPending}
              onClick={() => confirmTime.mutate({ id: runId }, { onSuccess: () => void refresh(), onError: (e) => toast.error(pressErrorText(t, e)) })}
            >
              {t("press.console.timeAsk")}
            </Button>
          )}
        </Card>
      ) : null}
      {data.run.lateEntry && !data.run.lateEntryApproved ? <p className="m-0 text-[14px] font-medium">{t("press.console.lateWaiting")}</p> : null}

      {error ? (
        <div role="alert" className="flex flex-col gap-2 rounded-card border border-border bg-card p-3" data-slot="save-error">
          <p className="m-0 text-[15px] font-medium text-destructive">{error.message}</p>
          {error.retry ? (
            <Button variant="secondary" onClick={error.retry} disabled={busy}>
              {t("press.console.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {gates && gates.length > 0 ? (
        <div role="alert" className="flex flex-col gap-2 rounded-card border border-border bg-card p-3" data-slot="close-refused">
          <p className="m-0 text-[15px] font-semibold">{t("press.console.logFailed")}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {gateSentences(gates, t, preview.data?.gateText ?? []).map((sentence, i) => (
              <li key={`${gates[i]}-${i}`} className="text-[15px] font-medium text-destructive">
                {sentence}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="m-0 text-[14px] font-medium">
          {notice}
        </p>
      ) : null}

      <FormActions className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+0.75rem)]">
        {draft.step > 0 ? (
          <Button variant="secondary" size="lg" disabled={busy} onClick={() => patch({ step: draft.step - 1 })}>
            {t("press.console.back")}
          </Button>
        ) : null}
        {!last ? (
          <Button size="lg" disabled={busy} aria-busy={busy} onClick={() => void next()}>
            {t("press.console.saveNext")}
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => void saveNotesClick()}>
              {t("press.console.save")}
            </Button>
            <Can do="press.close">
              <Button size="lg" disabled={busy} aria-busy={busy} onClick={() => void logRun()}>
                {t("press.console.logRun")}
              </Button>
            </Can>
          </>
        )}
      </FormActions>
      {last && !canClose ? <p className="m-0 text-[14px] text-muted-foreground">{t("press.console.waitingSupervisor")}</p> : null}
    </div>
  );
}

/** The server's close figures, "not saved" (`press.runs.preview`). */
function PreviewPanel({
  data,
  figures,
  pending,
  warnPct,
  gates,
  showGates,
  canClose,
  t,
  onGoto,
}: {
  data: RunDetail;
  figures: { inputG: number; inputWeighedG: number; goodG: number; rejectG: number; recoveryPct: string | null; balanceG: number; balanceWarn: boolean; short: boolean } | undefined;
  pending: boolean;
  warnPct: number;
  gates: readonly string[];
  showGates: boolean;
  canClose: boolean;
  t: ReturnType<typeof useT>["t"];
  onGoto: (step: number) => void;
}) {
  const visible = gates.filter((g) => canClose || (g !== "no_close_permission" && g !== "not_supervisor"));
  return (
    <section aria-labelledby="close-preview" data-slot="close-preview" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface-sunken p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="close-preview" className="m-0 text-[15px] font-semibold">
          {t("press.console.previewTitle")}
        </h3>
        <Chip tone="amber" truncate={false}>
          {t("press.console.notSaved")}
        </Chip>
      </div>
      {figures ? (
        <>
          <div>
            <p className="m-0 text-[13px] font-medium text-muted-foreground">{t("press.console.recoveryNow")}</p>
            <p data-testid="preview-recovery" className="m-0 font-display text-[40px] font-extrabold leading-none tabular-nums">
              {figures.recoveryPct === null ? "—" : `${figures.recoveryPct}%`}
            </p>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fig label={t("press.console.input")} value={`${kgFromG(figures.inputG)} ${t("units.kg")}`} testid="preview-input" />
            <Fig label={t("press.console.good")} value={`${kgFromG(figures.goodG)} ${t("units.kg")}`} testid="preview-good" />
            <Fig label={t("press.console.reject")} value={`${kgFromG(figures.rejectG)} ${t("units.kg")}`} testid="preview-reject" />
            <Fig label={t("press.console.balanceLabel")} value={`${kgFromG(figures.balanceG)} ${t("units.kg")}`} testid="preview-balance" />
          </dl>
          {figures.balanceWarn ? <p className="m-0 text-[14px] leading-6">{t("press.console.balanceWarn", { pct: warnPct })}</p> : null}
        </>
      ) : pending ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("press.console.loading")}</p>
      ) : null}
      {showGates && visible.length > 0 ? (
        <div data-slot="gates">
          <p className="m-0 text-[13px] font-medium text-muted-foreground">{t("press.console.gatesTitle")}</p>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {visible.map((g) => {
              const sentence = gateSentences([g], t)[0]!;
              return (
                <li key={g} className="flex flex-wrap items-baseline gap-x-2 text-[14px]" data-gate={g}>
                  <span>{sentence}</span>
                  {stepOfGate(g) < COUNT_STEPS.length - 1 ? (
                    <Button variant="ghost" size="xs" onClick={() => onGoto(stepOfGate(g))} aria-label={`${sentence} (${t(`press.console.steps.${COUNT_STEPS[stepOfGate(g)]!}` as MessageKey)})`}>
                      {t(`press.console.steps.${COUNT_STEPS[stepOfGate(g)]!}` as MessageKey)}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : showGates && figures ? (
        <p className="m-0 text-[14px] font-medium">{t("press.console.readyToLog")}</p>
      ) : null}
      {data.run.lateEntry ? <Chip tone="amber" truncate={false}>{t("press.console.lateBadge")}</Chip> : null}
    </section>
  );
}

function Fig({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd data-testid={testid} className="m-0 mt-0.5 font-mono text-[16px] font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}
