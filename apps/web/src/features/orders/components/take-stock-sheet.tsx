import { MAX_REALLOCATE_BUNDLES } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { orderErrorLines } from "../errors";
import { orderKgText } from "../format";
import { REALLOCATE_REASONS, reallocateProblem } from "../view";
import { FieldSelect } from "./controls";
import { StockList } from "./stock-sheet";

export type TakeStockTarget = {
  lineId: string;
  lineNo: number;
  orderNumber: string;
  sectionId: string;
  cutLengthMm: number;
  orderId: string;
  customerId: string;
};

type Done = { status: "applied" | "pending"; count: number; kgG: number };

/**
 * The ready-stock prompt leads here (FP-OP-09/10, review I-4): the bundles `orders.matchStock`
 * offers for this line, ticked and put on it with `orders.reallocate`. Plant stock, bundles on no
 * order and this customer's own apply at once; another customer's (or plant stock that came from
 * one) wait for a manager. The server decides every case; the sheet shows what it answered.
 */
export function TakeStockSheet({
  open,
  onOpenChange,
  target,
  formatLength,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  target: TakeStockTarget;
  formatLength(mm: number): string;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<Done | null>(null);

  const stock = useQuery({
    ...trpc.orders.matchStock.queryOptions({ sectionId: target.sectionId, cutLengthMm: target.cutLengthMm, customerId: target.customerId }),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setReasonCode("");
      setNote("");
      setErrors([]);
      setDone(null);
    }
  }, [open]);

  // Bundles already on this line are not "ready stock" for it.
  const items = useMemo(() => (stock.data?.items ?? []).filter((i) => i.lineId !== target.lineId), [stock.data, target.lineId]);
  const mismatched = items.filter((i) => selected.has(i.id) && i.lengthMm !== target.cutLengthMm);
  const problem = reallocateProblem({ selected: selected.size, max: MAX_REALLOCATE_BUNDLES, mismatch: mismatched.length > 0, reasonCode, note });

  const take = useMutation({
    mutationFn: () =>
      trpcClient.orders.reallocate.mutate({
        bundleIds: [...selected],
        toLineId: target.lineId,
        ...(reasonCode ? { reasonCode } : {}),
        ...(note.trim() ? { reason: note.trim() } : {}),
      }),
    onSuccess: async (res) => {
      setErrors([]);
      setDone({ status: res.status, count: res.status === "applied" ? res.moved : selected.size, kgG: res.kgG });
      if (res.status === "applied") toast.success(t("reallocate.moved", { count: res.moved }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.orders.get.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.timeline.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.matchStock.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.lineBundles.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.reallocations.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.list.queryKey() }),
      ]);
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
        {t("reallocate.leave")}
      </Button>
      <Button
        onClick={() => {
          setErrors([]);
          take.mutate();
        }}
        disabled={problem != null || take.isPending}
      >
        {take.isPending ? t("common.saving") : t("orders.stock.putOnLine")}
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("orders.stock.takeTitle", { n: target.lineNo })}
      description={t("orders.stock.takeHint")}
      footer={footer}
    >
      {done ? (
        <div role="status" data-take-result={done.status} className="flex flex-col gap-3">
          {done.status === "pending" ? (
            <>
              <Chip tone="amber" truncate={false}>
                {t("reallocate.waiting")}
              </Chip>
              <p className="m-0 text-[15px] font-medium leading-6">{t("reallocate.waitingBody", { count: done.count, kg: orderKgText(done.kgG) })}</p>
              <Button variant="secondary" asChild className="self-start">
                <Link to="/approvals" search={{ kind: "order_reallocate" }}>
                  {t("reallocate.openRequest")}
                </Link>
              </Button>
            </>
          ) : (
            <p className="m-0 text-[15px] font-medium leading-6">{t("reallocate.moved", { count: done.count })}</p>
          )}
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
            <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("orders.stock.noneToTake")}</p>
          ) : (
            <StockList items={items} formatLength={formatLength} selected={selected} onToggle={toggle} />
          )}

          {mismatched.length > 0 ? (
            <p role="status" data-length-warning="" className="m-0 text-[14px] font-medium leading-5 text-tone-amber-ink">
              {t("reallocate.lengthWarning", { count: mismatched.length, order: target.orderNumber, line: target.lineNo, length: formatLength(target.cutLengthMm) })}
            </p>
          ) : null}

          <Field label={t("reallocate.reasonCode")}>
            <FieldSelect value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-label={t("reallocate.reasonCode")}>
              <option value="">{t("reallocate.reasonNone")}</option>
              {REALLOCATE_REASONS.map((code) => (
                <option key={code} value={code}>
                  {t(`reasons.reallocate.${code}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label={t("common.note")}>
            <FieldTextArea value={note} onChangeText={setNote} rows={2} />
          </Field>

          {problem && selected.size > 0 ? (
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t(problem, { max: MAX_REALLOCATE_BUNDLES })}</p>
          ) : null}
          {errors.length > 0 ? (
            <div role="alert" className="flex flex-col gap-1">
              {errors.map((e) => (
                <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
                  {e}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
