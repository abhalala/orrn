import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useEffect, useMemo } from "react";

import { Can } from "@/shared/components/can";

import { ChoiceRadios, type Choice } from "./choice-radios";
import {
  castRequired,
  copyLocked,
  packableCopy,
  sourceBlockers,
  trolleyRequired,
  withAgeingRow,
  withCast,
  withCopy,
  withPinOverride,
  withPinnedLine,
  type SourceBlocker,
  type SourceChoice,
} from "./source-gate";
import { packLineChoices } from "./pack-lines";
import { useCasts, useDieCopies, useOpenLines, useOwnerCheck, useTrolleyLines } from "./use-pack-server";
import { kg12Text } from "./line-preview";

const NONE = "";

/** What the Source step needs from the server, and the blockers it adds up to (Next waits on them). */
export function useSourceGate(dieId: string | null, choice: SourceChoice, settings: unknown) {
  const copies = useDieCopies(dieId);
  const lines = useOpenLines(dieId);
  const casts = useCasts();
  const liveCasts = useMemo(() => (casts.data?.items ?? []).filter((c) => c.meltCount > 0), [casts.data]);
  const line = lines.data?.find((l) => l.lineId === choice.salesOrderLineId);
  const owner = useOwnerCheck({ dieId, dieInstanceId: choice.dieInstanceId, customerId: line?.customerId ?? null });
  const trolleys = useTrolleyLines(dieId);
  const required = castRequired(settings, liveCasts.length);
  const blockers = sourceBlockers({ choice, castRequired: required, owner: owner.data, trolleyRequired: trolleyRequired(settings, trolleys.data?.items.length ?? 0) });
  const loading = copies.isPending || lines.isPending || casts.isPending || owner.isPending;
  return { copies, lines, liveCasts, line, owner, trolleys, castRequired: required, blockers, loading };
}

type Gate = ReturnType<typeof useSourceGate>;

/**
 * The Source step (FP-PK-01/04/10): these are hand-packed bundles ("No trolley"; a trolley row is
 * offered once ageing is in use), the order they are packed for, the die copy, the cast and the
 * label logo. All of it is optional unless the plant's rules or an owned die say otherwise.
 */
export function SourceExtras({
  choice,
  onChange,
  gate,
  showErrors,
  onPickTrolley,
}: {
  choice: SourceChoice;
  onChange(next: SourceChoice): void;
  gate: Gate;
  showErrors: boolean;
  /** A trolley line was picked: the Source step may fill the cut length from it. */
  onPickTrolley?(row: { cutLengthMm: number } | null): void;
}) {
  const { t } = useT();
  const blockers = gate.blockers;
  const has = (k: SourceBlocker["kind"]) => blockers.find((b) => b.kind === k);
  // D15: the copy the chosen line pins (the server refuses another unless the office overrides).
  const pinOf = (lineId: string | undefined) => (lineId ? (gate.lines.data?.find((l) => l.lineId === lineId)?.pinnedCopyId ?? null) : null);
  const pinnedCopyId = gate.line?.pinnedCopyId ?? null;
  const pinnedCode = gate.line?.pinnedCopyCode ?? null;
  const locked = copyLocked(choice, pinnedCopyId);
  // A draft restored before the pin was known, or a line picked before the copies loaded: follow the pin.
  useEffect(() => {
    if (pinnedCopyId && !choice.overridePin && choice.dieInstanceId !== pinnedCopyId) onChange(withCopy(choice, pinnedCopyId));
  }, [pinnedCopyId, choice, onChange]);

  const lineChoices: Choice[] = [
    // D20: a deliberate choice; the server writes these bundles as plant stock.
    { value: NONE, label: t("pack.source.plantStock"), detail: t("pack.source.plantStockHint") },
    // Wave-2 M9: confirmed lines first, the suggestion among them; bookings last, marked.
    ...packLineChoices(gate.lines.data ?? []).map(({ line: l, suggested, booking }) => ({
      value: l.lineId,
      label: (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono">{`${l.orderNumber}/${l.lineNo}`}</span>
          <span className="font-medium text-muted-foreground">{l.customerName}</span>
          {suggested ? <Chip tone="blue">{t("pack.source.suggested")}</Chip> : null}
          {booking ? <Chip tone="amber">{t("pack.source.booking")}</Chip> : null}
        </span>
      ),
      ariaLabel: `${l.orderNumber}/${l.lineNo} ${l.customerName}`,
      detail: t("pack.source.lineDetail", { baki: formatKgTotal(gToKg(l.bakiG)), ordered: formatKgTotal(gToKg(l.orderedG)) }),
    })),
  ];

  const copyChoices: Choice[] = [
    ...(has("copy") || has("owned") || pinnedCopyId ? [] : [{ value: NONE, label: t("pack.source.noCopy"), detail: t("pack.source.noCopyHint") }]),
    ...(gate.copies.data?.items ?? [])
      .filter((c) => packableCopy(c.status))
      .map((c) => ({
        value: c.id,
        disabled: locked && c.id !== pinnedCopyId,
        label: <span className="font-mono">{c.code}</span>,
        ariaLabel: c.code,
        detail: [
          c.tierRank != null ? t("dieRoom.copies.tier", { rank: c.tierRank }) : null,
          t(`dieRoom.status.${c.status}`),
          c.latestMilli != null ? t("pack.source.latest", { kg: kg12Text(c.latestMilli) ?? "" }) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
  ];

  const trolleyRows = gate.trolleys.data?.items ?? [];
  const trolleyChoices: Choice[] = [
    { value: NONE, label: t("pack.source.noTrolley"), detail: t("pack.source.noTrolleyHint") },
    ...trolleyRows.map((r) => ({
      value: r.ageingRowId,
      label: (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono">{r.trolleyCode}</span>
          <span className="font-mono text-muted-foreground">{r.batchNumber}</span>
          <span className="font-medium">{t("pack.source.trolleyLeft", { pcs: r.remainingPcs })}</span>
        </span>
      ),
      ariaLabel: `${r.trolleyCode} ${r.batchNumber}`,
      detail: [
        r.dieInstanceCode ? `${r.sectionLabel} · ${r.dieInstanceCode}` : r.sectionLabel,
        t("pack.source.trolleyCut", { mm: r.cutLengthMm }),
        r.castCode ? t("pack.source.trolleyCast", { cast: r.castCode }) : null,
        r.salesOrderNumber ? `${r.salesOrderNumber}${r.customerName ? ` · ${r.customerName}` : ""}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  ];

  const castChoices: Choice[] = [
    ...(gate.castRequired ? [] : [{ value: NONE, label: t("pack.source.noCast") }]),
    ...gate.liveCasts.map((c) => ({
      value: c.id,
      label: <span className="font-mono">{c.number}</span>,
      ariaLabel: c.number,
      detail: [c.alloy, c.grade].filter(Boolean).join(" · ") || undefined,
    })),
  ];

  const owned = blockers.find((b): b is Extract<SourceBlocker, { kind: "owned" | "noCopies" }> => b.kind === "owned" || b.kind === "noCopies");
  const copyOwnerNeedsPick = has("copy");

  return (
    <div data-slot="source-extras" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-slot="pack-source">
        <span className="text-[14px] font-semibold">{t("pack.source.title")}</span>
        <Chip tone="neutral">{choice.ageingRowId ? t("pack.source.trolley") : t("pack.source.hand")}</Chip>
        <span className="text-[13px] text-muted-foreground">{choice.ageingRowId ? t("pack.source.trolleyHint") : t("pack.source.handHint")}</span>
      </div>

      {trolleyChoices.length > 1 ? (
        <ChoiceRadios
          slot="trolley-picker"
          legend={t("pack.source.trolleyLine")}
          hint={t("pack.source.trolleyLineHint")}
          error={showErrors && has("trolley") ? t("pack.source.trolleyRequired") : undefined}
          choices={trolleyChoices}
          value={choice.ageingRowId ?? NONE}
          onChange={(v) => {
            const picked = trolleyRows.find((r) => r.ageingRowId === v);
            // The line's cast and die copy follow it, so the server's cast check agrees (a pinned order copy stays).
            let next = withAgeingRow(choice, v || undefined);
            const cast = picked?.castCode ? gate.liveCasts.find((c) => c.number === picked.castCode) : undefined;
            if (cast) next = withCast(next, cast.id);
            const copy = picked?.dieInstanceCode && !pinnedCopyId ? (gate.copies.data?.items ?? []).find((c) => c.code === picked.dieInstanceCode && packableCopy(c.status)) : undefined;
            if (copy) next = withCopy(next, copy.id);
            onChange(next);
            onPickTrolley?.(picked ? { cutLengthMm: picked.cutLengthMm } : null);
          }}
        />
      ) : null}

      {gate.lines.isPending ? (
        <Skeleton className="h-24 rounded-input" />
      ) : (
        <ChoiceRadios
          slot="order-picker"
          legend={t("pack.forOrder")}
          hint={t("pack.source.forOrderHint")}
          choices={lineChoices}
          value={choice.salesOrderLineId ?? NONE}
          onChange={(v) => onChange(withPinnedLine(choice, v || undefined, pinOf(v || undefined)))}
        />
      )}

      {copyChoices.length > (has("copy") || has("owned") || pinnedCopyId ? 0 : 1) ? (
        <ChoiceRadios
          slot="copy-picker"
          legend={t("pack.source.copy")}
          hint={pinnedCode ? `${t("pack.source.pinned", { code: pinnedCode })} ${t("pack.source.copyHint")}` : t("pack.source.copyHint")}
          error={showErrors && copyOwnerNeedsPick ? t("pack.source.copyRequired") : undefined}
          choices={copyChoices}
          value={choice.dieInstanceId ?? NONE}
          onChange={(v) => onChange(withCopy(choice, v || undefined))}
        />
      ) : null}

      {pinnedCopyId ? (
        <Can do="order.manage">
          <label data-slot="pin-override" className="inline-flex min-h-11 items-center gap-3 self-start text-[15px] font-semibold">
            <input
              type="checkbox"
              checked={Boolean(choice.overridePin)}
              onChange={(e) => onChange(withPinOverride(choice, e.currentTarget.checked, pinnedCopyId))}
              className="size-5 accent-[var(--color-primary)]"
            />
            {t("pack.source.pinnedOverride")}
          </label>
        </Can>
      ) : null}

      {castChoices.length > (gate.castRequired ? 0 : 1) ? (
        <ChoiceRadios
          slot="cast-picker"
          legend={t("pack.source.cast")}
          hint={gate.castRequired ? t("pack.source.castRequiredHint") : t("pack.source.castHint")}
          error={showErrors && has("cast") ? t("pack.source.castRequired") : undefined}
          choices={castChoices}
          value={choice.castId ?? NONE}
          onChange={(v) => onChange(withCast(choice, v || undefined))}
        />
      ) : null}

      {owned ? (
        <p
          role="alert"
          data-slot="owned-die"
          className="m-0 flex items-start gap-2.5 rounded-card bg-tone-amber-tint px-4 py-3 text-[14px] leading-6 font-medium text-tone-amber-ink"
        >
          {owned.kind === "noCopies"
            ? t("pack.source.noCopies")
            : owned.ownerName
              ? t("pack.dieOwned", { name: owned.ownerName })
              : t("pack.dieOwnedOther")}
          {owned.kind === "owned" ? ` ${t("pack.source.ownedHint")}` : ""}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <LogoSwitch on={choice.showLogo} onChange={(showLogo) => onChange({ ...choice, showLogo })} />
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("pack.source.logoHint")}</p>
      </div>
    </div>
  );
}

function LogoSwitch({ on, onChange }: { on: boolean; onChange(next: boolean): void }) {
  const { t } = useT();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      data-testid="logo-switch"
      className="inline-flex min-h-11 items-center gap-3 self-start rounded-full text-left text-[15px] font-semibold"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-[var(--dur-fast)]",
          on ? "bg-foreground" : "bg-control/45",
        )}
      >
        <span
          className={cn(
            "absolute top-1 left-1 size-5 rounded-full bg-background transition-transform duration-[var(--dur-fast)]",
            on ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
      {t("pack.showLogo")}
    </button>
  );
}

