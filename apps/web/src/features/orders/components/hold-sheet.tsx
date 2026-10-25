import { MAX_HOLD_BUNDLES } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { orderErrorLines } from "../errors";
import { orderKgText, pcsText } from "../format";
import { holdableItems } from "../view";
import { StockList } from "./stock-sheet";

export type HoldTarget = {
  lineId: string;
  lineNo: number;
  orderNumber: string;
  sectionId: string;
  cutLengthMm: number;
  customerId: string;
};

/** After a hold or a release: the order, its book row, the stock prompts and the line's holds. */
function refreshAfterHold(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.orders.get.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.orders.timeline.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.orders.matchStock.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.orders.holds.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.orders.list.queryKey() }),
  ]);
}

function Errors({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-1">
      {lines.map((e) => (
        <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

type HoldDone = {
  held: string[];
  alreadyHeld: string[];
  kgG: number;
  warnings: { serial: string; bundleLengthMm: number; lineLengthMm: number }[];
};

/**
 * "Hold stock" for an order line (FP-OP-17, BACKLOG 32): the yard bundles of the line's die on no
 * order or on this line (`orders.matchStock`), ticked (at most 100) and held with `orders.hold`.
 * The bundles stay where they are; while held, a dispatch for another customer refuses them
 * ("Held for SO-n"). A different cut length is held with the server's warning.
 */
export function HoldStockSheet({
  open,
  onOpenChange,
  target,
  formatLength,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  target: HoldTarget;
  formatLength(mm: number): string;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<HoldDone | null>(null);

  const stock = useQuery({
    ...trpc.orders.matchStock.queryOptions({ sectionId: target.sectionId, cutLengthMm: target.cutLengthMm, customerId: target.customerId, limit: 100 }),
    enabled: open,
  });
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setNote("");
      setErrors([]);
      setDone(null);
    }
  }, [open]);

  const items = useMemo(() => holdableItems(stock.data?.items ?? [], target.lineId), [stock.data, target.lineId]);
  const tooMany = selected.size > MAX_HOLD_BUNDLES;

  const hold = useMutation({
    mutationFn: () => trpcClient.orders.hold.mutate({ lineId: target.lineId, bundleIds: [...selected], ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: async (res) => {
      setErrors([]);
      setDone({ held: res.held, alreadyHeld: res.alreadyHeld, kgG: res.kgG, warnings: res.warnings });
      toast.success(t("orders.hold.heldDone", { count: res.held.length, kg: orderKgText(res.kgG) }));
      await refreshAfterHold(queryClient);
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const footer = done ? (
    <Button onClick={() => onOpenChange(false)}>{t("common.done")}</Button>
  ) : (
    <>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>
        {t("common.cancel")}
      </Button>
      <Button
        data-hold-submit=""
        onClick={() => {
          setErrors([]);
          hold.mutate();
        }}
        disabled={selected.size === 0 || tooMany || hold.isPending}
      >
        {hold.isPending ? t("common.saving") : t("orders.hold.submit", { count: selected.size })}
      </Button>
    </>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("orders.hold.sheetTitle", { n: target.lineNo })} description={t("orders.hold.hint")} footer={footer}>
      {done ? (
        <div role="status" data-hold-result="" className="flex flex-col gap-2">
          <p className="m-0 text-[15px] font-medium leading-6">{t("orders.hold.heldDone", { count: done.held.length, kg: orderKgText(done.kgG) })}</p>
          {done.alreadyHeld.length > 0 ? <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("orders.hold.alreadyList", { serials: done.alreadyHeld.join(", ") })}</p> : null}
          {done.warnings.map((w) => (
            <p key={w.serial} data-hold-length-warning="" className="m-0 text-[14px] font-medium leading-5 text-tone-amber-ink">
              {t("orders.hold.lengthWarning", { serial: w.serial, length: formatLength(w.bundleLengthMm), lineLength: formatLength(w.lineLengthMm) })}
            </p>
          ))}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {stock.isPending ? (
            <div aria-busy="true" className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : stock.isError ? (
            <p role="alert" className="m-0 text-[14px] leading-5 text-destructive">
              {t("errors.generic")}
            </p>
          ) : items.length === 0 ? (
            <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("orders.hold.none")}</p>
          ) : (
            <StockList items={items} formatLength={formatLength} selected={selected} onToggle={toggle} />
          )}
          {tooMany ? <p className="m-0 text-[13px] leading-5 text-destructive">{t("orders.hold.tooMany", { max: MAX_HOLD_BUNDLES })}</p> : null}
          <Field label={t("common.note")}>
            <FieldTextArea value={note} onChangeText={setNote} rows={2} />
          </Field>
          <Errors lines={errors} />
        </div>
      )}
    </Sheet>
  );
}

/**
 * The bundles held for a line (`orders.holds`), where each lies now, with "Release" for the ticked
 * ones or all of them (`orders.release`). The bundles stay where they are.
 */
export function HeldSheet({
  open,
  onOpenChange,
  target,
  formatLength,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  target: HoldTarget;
  formatLength(mm: number): string;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const holds = useQuery({ ...trpc.orders.holds.queryOptions({ lineId: target.lineId, limit: 200 }), enabled: open });
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setErrors([]);
    }
  }, [open]);

  const release = useMutation({
    mutationFn: (bundleIds: string[] | null) => trpcClient.orders.release.mutate({ lineId: target.lineId, ...(bundleIds ? { bundleIds } : {}) }),
    onSuccess: async (res) => {
      setErrors([]);
      setSelected(new Set());
      toast.success(t("orders.hold.released", { count: res.released.length }));
      await refreshAfterHold(queryClient);
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  const items = holds.data?.items ?? [];
  const footer = (
    <>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>
        {t("common.done")}
      </Button>
      {items.length > 0 ? (
        <>
          <Button variant="secondary" data-release-selected="" disabled={selected.size === 0 || release.isPending} onClick={() => release.mutate([...selected])}>
            {t("orders.hold.releaseSelected", { count: selected.size })}
          </Button>
          <Button data-release-all="" disabled={release.isPending} onClick={() => release.mutate(null)}>
            {t("orders.hold.releaseAll")}
          </Button>
        </>
      ) : null}
    </>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("orders.hold.listTitle", { n: target.lineNo })} footer={footer}>
      <div className="flex min-w-0 flex-col gap-3" data-held-list="">
        {holds.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : holds.isError ? (
          <p role="alert" className="m-0 text-[14px] leading-5 text-destructive">
            {t("errors.generic")}
          </p>
        ) : items.length === 0 ? (
          <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("orders.hold.empty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border p-0">
            {items.map((b) => (
              <li key={b.id} data-held-serial={b.serial} className="flex min-h-14 min-w-0 items-center gap-3 px-3 py-2">
                <Checkbox
                  aria-label={b.serial}
                  checked={selected.has(b.id)}
                  onCheckedChange={(on) =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (on === true) next.add(b.id);
                      else next.delete(b.id);
                      return next;
                    })
                  }
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-mono text-[14px] font-semibold [overflow-wrap:anywhere]">{b.serial}</span>
                  <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                    {formatLength(b.lengthMm)} · {pcsText(b.pcs)} {t("units.pcs")} · {orderKgText(b.weightG)} {t("units.kg")}
                  </span>
                </span>
                {b.dispatchCode ? (
                  <Chip tone="amber" truncate={false}>
                    {t("orders.hold.onDispatch", { code: b.dispatchCode })}
                  </Chip>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Errors lines={errors} />
      </div>
    </Sheet>
  );
}
