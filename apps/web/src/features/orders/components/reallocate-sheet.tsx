import { MAX_REALLOCATE_BUNDLES } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { reasonOptions } from "@/features/press/reason-label";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { orderErrorLines } from "../errors";
import { FieldSelect } from "./controls";
import { orderKgText, pcsText } from "../format";
import { isMovable, lengthMismatches, reallocateProblem } from "../view";

export type ReallocateSource = {
  lineId: string;
  sectionId: string;
  orderNumber: string;
  orderId: string;
  customerId: string;
  lineNo: number;
};

type Done = { status: "applied" | "pending"; count: number; kgG: number };

/**
 * Move bundles off an order line (FP-OP-08/09): to plant stock, or to another open line of the SAME
 * die. A different cut length is allowed with a warning and a reason code. Plant stock and the same
 * customer apply at once; another customer's order waits for a manager (`status: pending`), and
 * nothing moves until it is approved. The server decides every case; this sheet only asks.
 */
export function ReallocateSheet({
  open,
  onOpenChange,
  source,
  formatLength,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  source: ReallocateSource;
  formatLength(mm: number): string;
}) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState<string>("plant");
  const [reasonCode, setReasonCode] = useState("");
  // W4-MASTERS I-3: the plant's active reallocate codes (Masters, Reason codes), never a fixed list.
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "reallocate" }), enabled: open, staleTime: 5 * 60_000 });
  const reasonChoices = reasonOptions(t, "reallocate", reasons.data, locale);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<Done | null>(null);

  const bundles = useQuery({ ...trpc.orders.lineBundles.queryOptions({ lineId: source.lineId, limit: 200 }), enabled: open });
  const targets = useQuery({ ...trpc.orders.openLines.queryOptions({ dieId: source.sectionId }), enabled: open });

  // A fresh sheet each time it opens.
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setDestination("plant");
      setReasonCode("");
      setNote("");
      setErrors([]);
      setDone(null);
    }
  }, [open]);

  const movable = useMemo(() => (bundles.data?.items ?? []).filter(isMovable), [bundles.data]);
  const otherLines = useMemo(() => (targets.data ?? []).filter((l) => l.lineId !== source.lineId), [targets.data, source.lineId]);
  const target = destination === "plant" ? null : (otherLines.find((l) => l.lineId === destination) ?? null);
  const mismatched = lengthMismatches(movable, selected, target?.cutLengthMm ?? null);
  const otherCustomer = target != null && target.customerId !== source.customerId;
  // Review m-5: "Select all" picks at most MAX_REALLOCATE_BUNDLES, so "all picked" is that many.
  const allPicked = movable.length > 0 && selected.size >= Math.min(movable.length, MAX_REALLOCATE_BUNDLES);

  const problem = reallocateProblem({
    selected: selected.size,
    max: MAX_REALLOCATE_BUNDLES,
    mismatch: mismatched.length > 0,
    reasonCode,
    note,
    requiresNote: reasonChoices.find((o) => o.value === reasonCode)?.requiresNote,
  });

  const move = useMutation({
    mutationFn: () =>
      trpcClient.orders.reallocate.mutate({
        bundleIds: [...selected],
        toLineId: target ? target.lineId : null,
        ...(reasonCode ? { reasonCode } : {}),
        ...(note.trim() ? { reason: note.trim() } : {}),
      }),
    onSuccess: async (res) => {
      setErrors([]);
      setDone({ status: res.status, count: res.status === "applied" ? res.moved : selected.size, kgG: res.kgG });
      if (res.status === "applied") toast.success(t("reallocate.moved", { count: res.moved }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.orders.get.queryKey({ id: source.orderId }) }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.timeline.queryKey() }),
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
          move.mutate();
        }}
        disabled={problem != null || move.isPending}
      >
        {move.isPending ? t("common.saving") : otherCustomer ? t("common.askApproval") : t("reallocate.move")}
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("reallocate.title")}
      description={t("reallocate.from", { order: source.orderNumber, line: source.lineNo })}
      footer={footer}
    >
      {done ? (
        <div role="status" data-reallocate-result={done.status} className="flex flex-col gap-3">
          {done.status === "pending" ? (
            <>
              <Chip tone="amber" truncate={false}>
                {t("reallocate.waiting")}
              </Chip>
              <p className="m-0 text-[15px] font-medium leading-6">
                {t("reallocate.waitingBody", { count: done.count, kg: orderKgText(done.kgG) })}
              </p>
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
          <section className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[13px] font-semibold text-muted-foreground">{t("reallocate.bundles")}</h3>
              {movable.length > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => setSelected(allPicked ? new Set() : new Set(movable.slice(0, MAX_REALLOCATE_BUNDLES).map((b) => b.id)))}
                >
                  {allPicked ? t("reallocate.clearAll") : t("reallocate.selectAll")}
                </Button>
              ) : null}
            </div>
            {bundles.isPending ? (
              <div aria-busy="true" className="flex flex-col gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : bundles.isError ? (
              <p role="alert" className="m-0 text-[14px] text-destructive">
                {t("errors.generic")}
              </p>
            ) : movable.length === 0 ? (
              <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("reallocate.noneToMove")}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {movable.map((b) => (
                  <li key={b.id}>
                    <label
                      htmlFor={`rb-${b.id}`}
                      className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-card border border-border bg-card px-3 py-2"
                    >
                      <Checkbox id={`rb-${b.id}`} checked={selected.has(b.id)} onCheckedChange={(v) => toggle(b.id, v === true)} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-mono text-[14px] font-medium tabular-nums">{b.serial}</span>
                        <span className="text-[13px] text-muted-foreground">
                          {orderKgText(b.weightG)} {t("units.kg")} · {pcsText(b.pcs)} {t("units.pcs")} · {formatLength(b.lengthMm)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Field label={t("reallocate.toLine")}>
            <FieldSelect value={destination} onChange={(e) => setDestination(e.target.value)} aria-label={t("reallocate.toLine")}>
              <option value="plant">{t("reallocate.toPlant")}</option>
              {otherLines.map((l) => (
                <option key={l.lineId} value={l.lineId}>
                  {l.orderNumber} · {l.customerName} · {t("orders.detail.lineShort", { n: l.lineNo })}
                </option>
              ))}
            </FieldSelect>
          </Field>
          {target ? (
            // Review m-7: a native select cuts long text, so the PO and length sit on their own line.
            <p data-reallocate-target="" className="m-0 font-mono text-[13px] leading-5 break-words text-muted-foreground">
              {target.poNumber ? `${target.poNumber} · ` : ""}
              {formatLength(target.cutLengthMm)}
            </p>
          ) : null}

          {destination === "plant" ? (
            <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("reallocate.plantNote")}</p>
          ) : otherCustomer ? (
            <p role="status" className="m-0 text-[14px] font-medium leading-5">
              {t("reallocate.needsApproval")}
            </p>
          ) : null}

          {mismatched.length > 0 && target ? (
            <p role="status" data-length-warning="" className="m-0 text-[14px] font-medium leading-5 text-tone-amber-ink">
              {t("reallocate.lengthWarning", {
                count: mismatched.length,
                order: target.orderNumber,
                line: target.lineNo,
                length: formatLength(target.cutLengthMm),
              })}
            </p>
          ) : null}

          <Field label={t("reallocate.reasonCode")}>
            <FieldSelect value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-label={t("reallocate.reasonCode")}>
              <option value="">{t("reallocate.reasonNone")}</option>
              {reasonChoices.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
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
