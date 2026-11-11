import { vehicleGate, type DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import type { MessageKey } from "@orrn/i18n";
import { useEffect, useRef, useState } from "react";

import type { CapacityReport } from "@/features/scan/scan-outcome";
import { FieldTextArea } from "@/features/catalog/field-text-area";
import { trpcClient } from "@/shared/utils/trpc";

import { CapacityBanner } from "./capacity-banner";
import { dispatchNow } from "./dispatch-now";
import { dispatchErrorText } from "./errors";
import { groupItems, type DispatchItem } from "./group-items";
import { plantTimeText } from "@/features/approvals/approval-view";
import { toZonedInput } from "@/features/orders/view";

import { useCompanyTimeZone } from "./hooks";
import { LATE_STATUS_KEY, lateBounds, lateCheck, type LateEntryAsk } from "./late-entry";
import { overdrawView, overLineText, type OverdrawState } from "./over-tolerance";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped2 } from "@/shared/lib/fmt-text";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  dispatch: { id: string; code: string; status: DispatchStatus; vehicleNo?: string | null };
  customerName: string;
  items: DispatchItem[];
  onDispatched(): void;
  /** A failed run may still have held the stock: refresh the screen. */
  onRefresh(): void;
  /** The truck's load against its capacity; over it, Dispatch asks why (FP-PK-12). */
  capacity?: CapacityReport | null;
  /** Lines past ordered + tolerance (pl-flow 61): listed in amber, with a note for the manager. */
  overdraw?: OverdrawState;
  /** Review 5: the late time already asked for (waiting) or approved; the sheet pre-fills and locks it. */
  lateEntry?: LateEntryAsk | null;
};

/**
 * The last check before a load leaves: totals, customer and the groups.
 * From Building it holds the stock first (the server only completes a held
 * dispatch), then dispatches; the packing list is written in the same step.
 */
export function CompleteSheet({ open, onOpenChange, dispatch, customerName, items, onDispatched, onRefresh, capacity, overdraw, lateEntry }: Props) {
  const { t } = useT();
  const fmt = useFmt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  // BACKLOG 62: no vehicle in the header, so the sheet asks for it and saves it first.
  const [vehicle, setVehicle] = useState("");
  const [vehicleError, setVehicleError] = useState<"missing" | "invalid" | null>(null);
  const needsVehicle = !dispatch.vehicleNo?.trim();
  const over = capacity?.state === "over";
  const overOrder = overdrawView(overdraw ?? null);
  const [overdrawNote, setOverdrawNote] = useState("");
  // Arch 52: the line or the internet was down; the paper packing list is entered at the time the truck left.
  const tz = useCompanyTimeZone();
  const [late, setLate] = useState(false);
  const [lateTime, setLateTime] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [lateError, setLateError] = useState<{ field: "time" | "reason"; key: MessageKey } | null>(null);
  // Review 5: locked to the asked time until "Use another time"; any other minute asks a manager again.
  const [lateLocked, setLateLocked] = useState(false);
  const locked = lateLocked && lateEntry ? lateEntry : null;
  // Held by this sheet a moment ago: a retry after a failed complete must not hold twice
  // (the refreshed status may not be back yet).
  const heldHere = useRef({ held: false });
  useEffect(() => {
    if (open) {
      heldHere.current = { held: false };
      setReason("");
      setReasonError(false);
      setVehicle("");
      setVehicleError(null);
      setOverdrawNote("");
      setLate(false);
      setLateTime("");
      setLateReason("");
      setLateError(null);
      setLateLocked(false);
    }
  }, [open]);
  // Pre-fill on open, and again when a press opens the request or a manager decides it.
  const askKey = lateEntry ? `${lateEntry.approvalId}:${lateEntry.status}` : "";
  useEffect(() => {
    if (!open || !lateEntry) return;
    setLate(true);
    setLateTime(toZonedInput(lateEntry.occurredAt, tz));
    setLateReason(lateEntry.reason);
    setLateError(null);
    setLateLocked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the ask itself changes
  }, [open, askKey, tz]);
  const groups = groupItems(items);
  const weightG = items.reduce((s, i) => s + i.weightG, 0);
  const kg = kgGrouped2(fmt, weightG);

  const confirm = async () => {
    const gate = vehicleGate(dispatch.vehicleNo, vehicle);
    if (gate.kind === "missing" || gate.kind === "invalid") {
      setVehicleError(gate.kind);
      document.getElementById("dispatch-vehicle")?.focus();
      return;
    }
    // Over the truck's capacity needs a reason; the server refuses without it and audits it.
    if (over && !reason.trim()) {
      setReasonError(true);
      document.getElementById("capacity-reason")?.focus();
      return;
    }
    // A locked time is sent as asked: the server decides (an approved time stands past 72 hours).
    const lateSend = !late ? null : locked ? { kind: "ok" as const, occurredAt: locked.occurredAt, reason: locked.reason } : lateCheck(lateTime, lateReason, tz, Date.now());
    if (lateSend?.kind === "error") {
      setLateError({ field: lateSend.field, key: lateSend.key });
      document.getElementById(lateSend.field === "time" ? "late-time" : "late-reason")?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (gate.kind === "save") await trpcClient.dispatch.update.mutate({ id: dispatch.id, vehicleNo: gate.vehicleNo });
      await dispatchNow(dispatch.status, heldHere.current, {
        reserve: () => trpcClient.dispatch.reserve.mutate({ id: dispatch.id }),
        complete: () =>
          trpcClient.dispatch.complete.mutate({
            id: dispatch.id,
            ...(over ? { capacityOverrideReason: reason.trim() } : {}),
            // pl-flow 61: the reason for sending more than the order goes with the request.
            ...(overOrder && overdrawNote.trim() ? { overdrawNote: overdrawNote.trim() } : {}),
            // Arch 52: the time the truck left and why; a second person approves that exact time.
            ...(lateSend?.kind === "ok" ? { occurredAt: lateSend.occurredAt, lateReason: lateSend.reason } : {}),
          }),
      });
      onOpenChange(false);
      onDispatched();
    } catch (err) {
      setError(dispatchErrorText(t, err));
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setError(undefined);
        onOpenChange(next);
      }}
      title={t("dispatch.confirmTitle", { code: dispatch.code })}
      description={t("dispatch.confirmBody", { bundles: items.length, kg, customer: customerName })}
      footer={
        <>
          <Button variant="secondary" size="lg" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" loading={busy} onClick={() => void confirm()} data-testid="confirm-dispatch">
            {t("dispatch.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <p data-no-truncate="" className="m-0 font-display text-[34px] leading-[1.05] font-extrabold tracking-[-0.035em] tabular-nums">
          {t("units.bundlesKg", { bundles: items.length, kg })}
        </p>
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border p-0">
          {groups.map((g) => (
            <li key={g.key} className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-4 py-2.5">
              <span className="min-w-0 text-[15px] font-semibold break-words">
                {g.labelled ? t("dispatch.build.groupNamed", { label: g.label }) : g.label}
              </span>
              <span className="shrink-0 text-[14px] text-muted-foreground tabular-nums">
                {t("dispatch.build.groupTotal", { bundles: g.bundles.length, kg: kgGrouped2(fmt, g.weightG) })}
              </span>
            </li>
          ))}
        </ul>
        {needsVehicle ? (
          <Field
            id="dispatch-vehicle"
            label={t("dispatch.header.vehicleNo")}
            hint={t("dispatch.vehicleNeeded")}
            error={vehicleError === "missing" ? t("dispatch.vehicleMissing") : vehicleError === "invalid" ? t("dispatch.header.vehicleHint") : undefined}
          >
            <TextInput
              id="dispatch-vehicle"
              value={vehicle}
              onChangeText={(v) => {
                setVehicle(v);
                setVehicleError(null);
              }}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={30}
              aria-invalid={vehicleError ? true : undefined}
              data-testid="dispatch-vehicle"
            />
          </Field>
        ) : (
          <p className="m-0 text-[15px] text-muted-foreground" data-testid="dispatch-vehicle-ready">
            {t("dispatch.vehicleOn", { vehicle: dispatch.vehicleNo! })}
          </p>
        )}
        <CapacityBanner capacity={capacity} />
        {over ? (
          <Field
            id="capacity-reason"
            label={t("dispatch.capacity.overReason")}
            hint={t("dispatch.capacity.overReasonHint")}
            error={reasonError ? t("dispatch.capacity.reasonRequired") : undefined}
          >
            <FieldTextArea
              id="capacity-reason"
              value={reason}
              onChangeText={(v) => {
                setReason(v);
                if (v.trim()) setReasonError(false);
              }}
              rows={2}
              maxLength={500}
              aria-invalid={reasonError ? true : undefined}
            />
          </Field>
        ) : null}
        {overOrder ? (
          <div data-over-tolerance="" className="flex flex-col gap-3 rounded-card bg-tone-amber-tint p-4">
            <p className="m-0 text-[15px] font-semibold text-tone-amber-ink">{t("dispatch.overTolerance.title")}</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-tone-amber-ink">
              {overOrder.lines.map((l) => (
                <li key={l.lineId}>{overLineText(t, l)}</li>
              ))}
            </ul>
            <p className="m-0 text-[14px] text-tone-amber-ink">{t(overOrder.statusKey)}</p>
            <Field id="overdraw-note" label={t("dispatch.overTolerance.noteLabel")} hint={t("dispatch.overTolerance.noteHint")}>
              <FieldTextArea id="overdraw-note" value={overdrawNote} onChangeText={setOverdrawNote} rows={2} maxLength={500} data-testid="overdraw-note" />
            </Field>
          </div>
        ) : null}
        <label className="-my-1 flex min-h-11 cursor-pointer items-center gap-3 self-start text-[15px] font-medium">
          <input
            type="checkbox"
            checked={late}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setLate(checked);
              setLateError(null);
            }}
            className="size-5 accent-[var(--color-foreground)]"
            data-testid="late-entry-toggle"
          />
          {t("dispatch.late.toggle")}
        </label>
        {late ? (
          <div data-late-entry="" className="flex flex-col gap-3">
            {locked ? (
              <div
                className={`flex flex-col gap-2 rounded-card p-4 ${locked.status === "approved" ? "bg-tone-green-tint text-tone-green-ink" : "bg-tone-amber-tint text-tone-amber-ink"}`}
                data-testid="late-locked"
                data-status={locked.status}
              >
                <p className="m-0 text-[15px] font-semibold">
                  {t(LATE_STATUS_KEY[locked.status], { when: plantTimeText(locked.occurredAt, tz) })}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  disabled={busy}
                  onClick={() => {
                    setLateLocked(false);
                    setLateTime("");
                    setLateReason("");
                    setLateError(null);
                  }}
                  data-testid="late-use-another"
                >
                  {t("dispatch.late.useAnother")}
                </Button>
              </div>
            ) : lateEntry ? (
              <p className="m-0 text-[14px] text-muted-foreground">{t("dispatch.late.anotherAsks")}</p>
            ) : null}
            <Field id="late-time" label={t("dispatch.late.time")} hint={t("dispatch.late.timeHint")} error={lateError?.field === "time" ? t(lateError.key) : undefined}>
              <TextInput
                id="late-time"
                type="datetime-local"
                value={lateTime}
                readOnly={locked !== null}
                {...(locked ? {} : lateBounds(tz, Date.now()))}
                onChange={(e) => {
                  setLateTime(e.currentTarget.value);
                  setLateError(null);
                }}
                aria-invalid={lateError?.field === "time" ? true : undefined}
                data-testid="late-time"
              />
            </Field>
            <Field id="late-reason" label={t("dispatch.late.reason")} hint={t("dispatch.late.reasonHint")} error={lateError?.field === "reason" ? t(lateError.key) : undefined}>
              <FieldTextArea
                id="late-reason"
                value={lateReason}
                readOnly={locked !== null}
                onChangeText={(v) => {
                  setLateReason(v);
                  setLateError(null);
                }}
                rows={2}
                maxLength={500}
                aria-invalid={lateError?.field === "reason" ? true : undefined}
                data-testid="late-reason"
              />
            </Field>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-[15px] font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
