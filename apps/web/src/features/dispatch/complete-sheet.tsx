import { formatKgTotal, type DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Sheet } from "@orrn/ui/components/sheet";
import { useState } from "react";

import { trpcClient } from "@/shared/utils/trpc";

import { dispatchErrorText } from "./errors";
import { groupItems, type DispatchItem } from "./group-items";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  dispatch: { id: string; code: string; status: DispatchStatus };
  customerName: string;
  items: DispatchItem[];
  onDispatched(): void;
  /** A failed run may still have held the stock: refresh the screen. */
  onRefresh(): void;
};

/**
 * The last check before a load leaves: totals, customer and the groups.
 * From Building it holds the stock first (the server only completes a held
 * dispatch), then dispatches; the packing list is written in the same step.
 */
export function CompleteSheet({ open, onOpenChange, dispatch, customerName, items, onDispatched, onRefresh }: Props) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const groups = groupItems(items);
  const weightG = items.reduce((s, i) => s + i.weightG, 0);
  const kg = formatKgTotal(weightG / 1000);

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (dispatch.status === "draft") await trpcClient.dispatch.reserve.mutate({ id: dispatch.id });
      await trpcClient.dispatch.complete.mutate({ id: dispatch.id });
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
                {t("dispatch.build.groupTotal", { bundles: g.bundles.length, kg: formatKgTotal(g.weightG / 1000) })}
              </span>
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="m-0 text-[15px] font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
