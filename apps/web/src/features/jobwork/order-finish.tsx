import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { useQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { kgWithUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useJobworkOn } from "./hooks";
import { finishParts } from "./model";

/**
 * Under an order line (row 33): has its finish been done? From `process.forOrder` (the server tallies the bundles per line):
 * finished, at the vendor, on the line, not finished yet. Shows nothing for a line that asks for no finish, for an order
 * with no such line, and while the job-work module is off (the query is not sent). One request serves every line of the order.
 */
export function OrderLineFinish({ orderId, lineId }: { orderId: string; lineId: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const on = useJobworkOn();
  const q = useQuery({ ...trpc.process.forOrder.queryOptions({ orderId }), enabled: on, meta: INLINE_ERROR_META, staleTime: 15_000, retry: false });
  const line = q.data?.lines.find((l) => l.lineId === lineId);
  const parts = line ? finishParts(line) : [];
  if (!line || parts.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="order-line-finish" data-line={lineId}>
      <p className="m-0 text-[13px] font-semibold text-muted-foreground">{t("jw.order.title", { finish: t(`jw.process.${line.finish}`) })}</p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t("jw.order.note")}>
        {parts.map((p) => (
          <li key={p.state} data-finish-part={p.state}>
            <Chip tone={p.tone} truncate={false}>
              {t(`jw.finishState.${p.state}`)} {t("jw.order.count", { bundles: p.bundles, weight: kgWithUnit(fmt, p.weightG) })}
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}
