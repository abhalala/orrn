import type { Fmt } from "@orrn/domain";
import { kgPer12ft, type DispatchStatus, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";
import { Tag, X } from "lucide-react";

import { Can } from "@/shared/components/can";

import { blockText, itemBlock, sortBlockedFirst } from "./blocked";
import { groupItems, type DispatchItem, type ItemGroup } from "./group-items";
import { OFF_BAND_TONE, offBandStatusKey } from "./off-band";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped2, massUnit, sectionText, sectionUnit } from "@/shared/lib/fmt-text";

export type BundleGroupsProps = {
  items: DispatchItem[];
  unit: LengthUnit;
  /** Decides which bundles are marked as stopping the next step (Hold stock / Dispatch). */
  dispatchStatus: DispatchStatus;
  /** Serials added a moment ago: they pop and tint green briefly. */
  fresh: ReadonlySet<string>;
  /** Bundles can be removed in this state (Build); the button shows only for dispatch.addBundle. */
  removable: boolean;
  /** Packing group labels can be set in this state; the button shows only for dispatch.addBundle. */
  labelable: boolean;
  removing?: string | null;
  onRemove?(item: DispatchItem): void;
  onEditLabel?(group: ItemGroup): void;
};

/** kg per 12 ft worked out from the row (two decimals in kg/12ft, as before); the plant's section weight unit otherwise. */
const kg12Text = (it: DispatchItem, fmt: Fmt) => {
  const v = kgPer12ft({ weightG: it.weightG, pieces: it.quantity, lengthMm: it.lengthMm });
  if (v === null) return "-";
  return fmt.unitOf("linear_mass").id === "kg_12ft" ? v.toFixed(2) : fmt.n("die.band", Math.round(v * 1000), "screen");
};

/** The remove button of a row, found again after a refetch to move focus (data-remove-serial). */
export const REMOVE_ATTR = "data-remove-serial";

/**
 * Bundles of a dispatch grouped as the packing list will group them (packing
 * group label, else section), each group with its subtotal. A table with
 * column headers from 1024px; compact two-line rows on phones and iPads.
 * Bundles that stop the next step (held for another dispatch, void, already
 * dispatched) come first in their group, tinted red with the reason.
 */
export function BundleGroups(props: BundleGroupsProps) {
  const wide = useMediaQuery(breakpoints.desktop);
  const groups = groupItems(sortBlockedFirst(props.items, props.dispatchStatus));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((g) => (
        <section
          key={g.key}
          aria-labelledby={`group-${cssId(g.key)}`}
          data-slot="bundle-group"
          className="min-w-0 overflow-hidden rounded-card border border-border bg-card"
        >
          <GroupHeader group={g} labelable={props.labelable} onEditLabel={props.onEditLabel} />
          {wide ? <GroupTable group={g} {...props} /> : <GroupRows group={g} {...props} />}
        </section>
      ))}
    </div>
  );
}

function cssId(key: string) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function GroupHeader({
  group,
  labelable,
  onEditLabel,
}: {
  group: ItemGroup;
  labelable: boolean;
  onEditLabel?(group: ItemGroup): void;
}) {
  const fmt = useFmt();
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 id={`group-${cssId(group.key)}`} className="m-0 font-display text-[17px] leading-snug font-bold tracking-[-0.015em] break-words">
          {group.labelled ? t("dispatch.build.groupNamed", { label: group.label }) : group.label}
        </h3>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground break-words">
          {group.labelled ? `${group.dieLabel}. ` : ""}
          <span className="tabular-nums">
            {t("dispatch.build.groupTotal", { bundles: group.bundles.length, kg: kgGrouped2(fmt, group.weightG) })}
          </span>
        </p>
      </div>
      {labelable && onEditLabel ? (
        <Can do="dispatch.addBundle">
          <Button variant="ghost" size="sm" className="-mr-2 min-h-11 shrink-0" aria-haspopup="dialog" onClick={() => onEditLabel(group)}>
            <Tag aria-hidden="true" strokeWidth={2} />
            {group.labelled ? t("dispatch.build.changeLabel") : t("dispatch.build.setLabel")}
            <span className="sr-only">: {group.labelled ? group.dieLabel : group.label}</span>
          </Button>
        </Can>
      ) : null}
    </div>
  );
}

function RemoveButton({ item, removing, onRemove, className }: { item: DispatchItem; removing?: string | null; onRemove?(item: DispatchItem): void; className?: string }) {
  const { t } = useT();
  return (
    <Can do="dispatch.addBundle">
      <IconButton
        className={cn("size-11", className)}
        label={t("dispatch.build.removeBundle", { serial: item.serial })}
        icon={<X strokeWidth={2} />}
        loading={removing === item.bundleId}
        onClick={() => onRemove?.(item)}
        {...{ [REMOVE_ATTR]: item.serial }}
      />
    </Can>
  );
}

function GroupTable({ group, unit, fresh, removable, removing, onRemove, dispatchStatus }: BundleGroupsProps & { group: ItemGroup }) {
  const fmt = useFmt();
  const { t } = useT();
  return (
    <table className="w-full border-collapse text-[14px]" aria-labelledby={`group-${cssId(group.key)}`}>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="h-10 px-4 pl-5 text-left text-[13px] font-semibold text-muted-foreground">
            {t("dispatch.build.colBundle")}
          </th>
          <th scope="col" className="h-10 px-4 text-right text-[13px] font-semibold text-muted-foreground">
            {t("dispatch.build.colWeight")}
          </th>
          <th scope="col" className="h-10 px-4 text-right text-[13px] font-semibold text-muted-foreground">
            {t("dispatch.build.colPcs")}
          </th>
          <th scope="col" className="h-10 px-4 text-right text-[13px] font-semibold text-muted-foreground">
            {t("dispatch.build.colLength")}
          </th>
          <th scope="col" className="h-10 px-4 text-right text-[13px] font-semibold text-muted-foreground">
            {t("dispatch.build.colKg12")}
          </th>
          {removable ? (
            <Can do="dispatch.addBundle">
              <th scope="col" className="h-10 w-16 pr-3">
                <span className="sr-only">{t("dispatch.build.colActions")}</span>
              </th>
            </Can>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {group.bundles.map((it) => {
          const isFresh = fresh.has(it.serial);
          const block = itemBlock(it, dispatchStatus);
          return (
            <tr
              key={it.bundleId}
              data-serial={it.serial}
              data-fresh={isFresh || undefined}
              data-blocked={block?.kind}
              className={cn(
                "border-b border-border last:border-0",
                block ? "bg-tone-red-tint" : isFresh && "bg-tone-green-tint",
              )}
            >
              <td className="h-12 px-4 py-2 pl-5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={cn("inline-block font-mono font-semibold whitespace-nowrap", isFresh && "animate-pop")}>{it.serial}</span>
                  {block ? <Chip tone="red">{blockText(t, block)}</Chip> : null}
                  {it.offBand ? <OffBandChip item={it} /> : null}
                </div>
              </td>
              <td className="px-4 text-right font-mono tabular-nums whitespace-nowrap">{kgGrouped2(fmt, it.weightG)}</td>
              <td className="px-4 text-right font-mono tabular-nums">{it.quantity}</td>
              <td className="px-4 text-right font-mono whitespace-nowrap">{fmt.q("bundle.length", it.lengthMm)}</td>
              <td className="px-4 text-right font-mono tabular-nums">{kg12Text(it, fmt)}</td>
              {removable ? (
                <Can do="dispatch.addBundle">
                  <td className="pr-3 text-right">
                    <RemoveButton item={it} removing={removing} onRemove={onRemove} />
                  </td>
                </Can>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Q36 decided: the bundle is more than 0.1 kg/12ft off the weight of its order line. The figures in
 * amber, and beside them where its approval stands (waiting, approved, rejected).
 */
function OffBandChip({ item }: { item: DispatchItem }) {
  const fmt = useFmt();
  const { t } = useT();
  const status = item.offBandStatus ?? null;
  return (
    <>
      <Chip tone="amber" truncate={false} data-off-band="">
        {t("dispatch.offBand.chip", {
          kg: sectionText(fmt, item.kgPer12ftMilli ?? 0),
          line: sectionText(fmt, item.lineKgPer12ftMilli ?? 0),
        })}
      </Chip>
      {status ? (
        <Chip tone={OFF_BAND_TONE[status]} truncate={false} data-off-band-status={status}>
          {t(offBandStatusKey(status))}
        </Chip>
      ) : null}
    </>
  );
}

function GroupRows({ group, unit, fresh, removable, removing, onRemove, dispatchStatus }: BundleGroupsProps & { group: ItemGroup }) {
  const fmt = useFmt();
  const { t } = useT();
  return (
    <ul className="m-0 list-none divide-y divide-border p-0">
      {group.bundles.map((it) => {
        const isFresh = fresh.has(it.serial);
        const block = itemBlock(it, dispatchStatus);
        return (
          <li
            key={it.bundleId}
            data-serial={it.serial}
            data-fresh={isFresh || undefined}
            data-blocked={block?.kind}
            className={cn(
              "flex min-h-16 min-w-0 items-center gap-3 px-4 py-2.5",
              block ? "bg-tone-red-tint" : isFresh && "bg-tone-green-tint",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className={cn("inline-block font-mono text-[16px] font-semibold [overflow-wrap:anywhere]", isFresh && "animate-pop")}>
                  {it.serial}
                </span>
                <span data-no-truncate="" className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">
                  {kgGrouped2(fmt, it.weightG)} {massUnit(fmt)}
                </span>
              </div>
              {block ? (
                <div className="flex min-w-0 py-0.5">
                  <Chip tone="red">{blockText(t, block)}</Chip>
                </div>
              ) : null}
              {it.offBand ? (
                <div className="flex min-w-0 flex-wrap gap-1.5 py-0.5">
                  <OffBandChip item={it} />
                </div>
              ) : null}
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-muted-foreground">
                <span className="font-mono">
                  {it.quantity} {t("units.pcs")} · {fmt.q("bundle.length", it.lengthMm)}
                </span>
                <span className="font-mono">
                  {kg12Text(it, fmt)} {sectionUnit(fmt)}
                </span>
              </div>
            </div>
            {removable ? <RemoveButton className="-mr-2 shrink-0" item={it} removing={removing} onRemove={onRemove} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
