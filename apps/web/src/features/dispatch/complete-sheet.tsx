import { vehicleGate, type DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { Input, TextArea } from "@orrn/ui/components/input";
import { Sheet } from "@orrn/ui/components/sheet";
import { useEffect, useRef, useState } from "react";

import type { CapacityReport } from "@/features/scan/scan-outcome";
import { trpcClient } from "@/shared/utils/trpc";

import { CapacityBanner } from "./capacity-banner";
import { dispatchNow } from "./dispatch-now";
import { dispatchErrorText } from "./errors";
import { groupItems, type DispatchItem } from "./group-items";
import { dispatchKgText } from "./format";

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
};

/**
 * The last check before a load leaves: totals, customer and the groups.
 * From Building it holds the stock first (the server only completes a held
 * dispatch), then dispatches; the packing list is written in the same step.
 */
export function CompleteSheet({ open, onOpenChange, dispatch, customerName, items, onDispatched, onRefresh, capacity }: Props) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  // BACKLOG 62: no vehicle in the header, so the sheet asks for it and saves it first.
  const [vehicle, setVehicle] = useState("");
  const [vehicleError, setVehicleError] = useState<"missing" | "invalid" | null>(null);
  const needsVehicle = !dispatch.vehicleNo?.trim();
  const over = capacity?.state === "over";
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
    }
  }, [open]);
  const groups = groupItems(items);
  const weightG = items.reduce((s, i) => s + i.weightG, 0);
  const kg = dispatchKgText(weightG);

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
                {t("dispatch.build.groupTotal", { bundles: g.bundles.length, kg: dispatchKgText(g.weightG) })}
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
            <Input
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
            <TextArea
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
        {error ? (
          <p role="alert" className="m-0 text-[15px] font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
