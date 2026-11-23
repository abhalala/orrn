import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { qtyText } from "@/features/store/store-labels";
import { useInvalidateStore } from "@/features/store/use-store";
import { useFmt } from "@/shared/lib/fmt";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

/**
 * Today for the storekeeper (store.txn), XE store row 72: items below their minimum, each with one
 * click to raise an indent for the reorder quantity. An item that already has a live indent shows it
 * instead (the server returns that indent rather than raising a second). Hidden when nothing is low.
 */
export function TodayStoreLowTile() {
  const { t } = useT();
  const fmt = useFmt();
  const invalidate = useInvalidateStore();
  const low = useQuery({ ...trpc.store.belowMinimum.queryOptions(), meta: INLINE_ERROR_META });
  const make = useMutation(trpc.store.indents.fromReorder.mutationOptions());
  const [made, setMade] = useState<Record<string, { number: string; existing: boolean }>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const items = low.data?.items ?? [];
  if (items.length === 0) return null;

  async function raise(itemId: string) {
    setBusy(itemId);
    setFailed(null);
    try {
      const res = await make.mutateAsync({ itemId });
      setMade((m) => ({ ...m, [itemId]: { number: res.number, existing: res.existing } }));
      void invalidate();
    } catch {
      setFailed(itemId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="today-store-low" data-testid="today-store-low" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-store-low" className="m-0 text-[17px] font-semibold">
          {t("store2.today.title")}
        </h2>
        <UiLink to="/store" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
          {t("store2.today.open")}
        </UiLink>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.slice(0, 8).map((i) => {
          const done = made[i.itemId];
          const number = done?.number ?? i.indent?.number ?? null;
          return (
            <li key={i.itemId} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="m-0 text-[15px] font-semibold break-words">{i.name}</p>
                <p className="m-0 text-[13px] text-muted-foreground break-words">
                  {t("store2.today.have", {
                    have: qtyText(t, Math.max(0, i.balanceMilli), i.unit, fmt),
                    min: qtyText(t, i.minMilli ?? 0, i.unit, fmt),
                  })}
                </p>
                {done ? (
                  <p role="status" className="m-0 text-[13px] font-medium break-words">
                    {done.existing ? t("store2.today.already", { number: done.number }) : t("store2.today.made", { number: done.number })}
                  </p>
                ) : null}
                {failed === i.itemId ? (
                  <p role="alert" className="m-0 text-[13px] font-medium text-destructive break-words">
                    {t("store2.today.failed")}
                  </p>
                ) : null}
              </div>
              {number ? (
                <Button asChild variant="secondary">
                  <UiLink to="/store/buy">{t("store2.today.openIndent", { number })}</UiLink>
                </Button>
              ) : (
                <Button loading={busy === i.itemId} disabled={busy !== null && busy !== i.itemId} onClick={() => void raise(i.itemId)}>
                  {busy === i.itemId ? t("store2.today.making") : t("store2.today.makeIndent")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
