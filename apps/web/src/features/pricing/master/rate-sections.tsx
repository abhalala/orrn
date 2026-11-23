import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Plus } from "lucide-react";

import { MasterSection } from "@/features/masters/masters-ui";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { rateText } from "@/shared/lib/fmt-text";

import { componentAlways, hasPending, type MasterKind, type RateItem, type RateRow } from "./rate-model";
import { rateName, rateQuoted } from "./rate-words";

/** One section per kind of rate: what applies now, any change waiting for a manager, and upcoming rates. */
export function RateSection({
  kind,
  items,
  onAdd,
  onChange,
}: {
  kind: MasterKind;
  items: readonly RateItem[];
  onAdd(): void;
  onChange(item: RateItem): void;
}) {
  const { t } = useT();
  const id = `price-kind-${kind}`;
  return (
    <MasterSection
      id={id}
      title={t(`price.master.kinds.${kind}.title`)}
      hint={t(`price.master.kinds.${kind}.hint`)}
      actions={
        <Can do="price.manage">
          <Button variant="secondary" onClick={onAdd} aria-haspopup="dialog" data-testid={`price-add-${kind}`}>
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("price.master.add")}
          </Button>
        </Can>
      }
    >
      {items.length === 0 ? (
        <p className="m-0 rounded-card border border-dashed border-border px-4 py-3 text-[14px] text-muted-foreground">{t("price.master.empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-labelledby={id}>
          {items.map((item) => (
            <li key={`${item.kind}|${item.key}`}>
              <RateCard item={item} onChange={() => onChange(item)} />
            </li>
          ))}
        </ul>
      )}
    </MasterSection>
  );
}

function RateCard({ item, onChange }: { item: RateItem; onChange(): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const name = rateName(t, item);
  const money = (row: RateRow) => rateQuoted(t, item, rateText(fmt, row.paise));
  const from = (row: RateRow) => t("price.master.from", { date: fmt.day(row.effectiveFrom) });
  const waiting = hasPending(item);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4" data-testid="price-rate" data-rate-key={`${item.kind}:${item.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="m-0 text-[16px] font-semibold break-words">{name}</h3>
          {item.kind === "component" ? (
            <p className="m-0 text-[13px] text-muted-foreground">{componentAlways(item) ? t("price.master.always") : t("price.master.optional")}</p>
          ) : null}
        </div>
        <Can do="price.manage">
          <Button variant="ghost" onClick={onChange} disabled={waiting} aria-label={t("price.master.changeLabel", { name })}>
            {t("price.master.change")}
          </Button>
        </Can>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-muted-foreground">{t("price.master.current")}</span>
        {item.current ? (
          <p className="m-0 text-[17px] font-semibold tabular-nums">
            {money(item.current)} <span className="text-[14px] font-normal text-muted-foreground">{from(item.current)}</span>
          </p>
        ) : (
          <p className="m-0 text-[15px] text-muted-foreground">{t("price.master.noCurrent")}</p>
        )}
      </div>

      {item.pending.map((row) => (
        <div key={row.id} className="flex flex-col gap-1 rounded-input bg-tone-amber-tint px-3 py-2 text-tone-amber-ink" data-testid="price-pending">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="amber">{t("price.master.waiting")}</Chip>
            <span className="text-[15px] font-semibold tabular-nums">{t("price.master.waitingLine", { rate: money(row), from: from(row) })}</span>
          </div>
          {row.reason ? <p className="m-0 text-[13px] break-words">{t("price.master.reasonLine", { reason: row.reason })}</p> : null}
        </div>
      ))}
      {waiting ? <p className="m-0 text-[13px] text-muted-foreground">{t("price.master.pendingBlocks")}</p> : null}

      {item.upcoming.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="price-upcoming">
          <span className="text-[13px] text-muted-foreground">{t("price.master.upcoming")}</span>
          {item.upcoming.map((row) => (
            <p key={row.id} className="m-0 text-[15px] tabular-nums">
              {t("price.master.upcomingLine", { rate: money(row), from: from(row) })}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
