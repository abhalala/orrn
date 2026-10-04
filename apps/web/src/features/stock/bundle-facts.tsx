import { formatKg, formatLength, gToKg, kgPer12ft, weightRange12ft, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { formatKgBand } from "./format";
import { rangeStatus } from "./timeline";

const RANGE_TONE = { inRange: "green", below: "amber", above: "amber", noRange: "neutral" } as const;

type Fact = { key: string; label: string; value: ReactNode; mono?: boolean };

/**
 * The bundle's facts on a white card (spec §3 `/b/:serial`): weight in kg,
 * pieces, cut length in the company unit, kg/12ft with its range chip against
 * the die's band, the billed weight range /12', the section, PO, packing
 * session and when it was packed. The section and session links are 44 px
 * tall on touch (spec §2), like the history's dispatch link.
 */
export function BundleFacts({
  bundle,
  die,
  group,
  lengthUnit,
  packedAt,
}: {
  bundle: { weightG: number; quantity: number; lengthMm: number; poNumber: string | null; dieId: string };
  die: { series: string; sectionCode: string; name: string | null; weightMinG: number; weightMaxG: number } | null;
  group: { id: string; code: string } | null;
  lengthUnit: LengthUnit;
  packedAt: string;
}) {
  const { t } = useT();
  const perFoot = kgPer12ft({ weightG: bundle.weightG, pieces: bundle.quantity, lengthMm: bundle.lengthMm });
  const range = die ? rangeStatus(perFoot, die.weightMinG, die.weightMaxG) : "noRange";
  const band = die ? formatKgBand(die.weightMinG, die.weightMaxG) : null;

  const facts: Fact[] = [
    { key: "weight", label: t("bundle.facts.weight"), value: `${formatKg(gToKg(bundle.weightG))} kg`, mono: true },
    { key: "pieces", label: t("bundle.facts.pieces"), value: String(bundle.quantity), mono: true },
    { key: "length", label: t("bundle.facts.cutLength"), value: formatLength(bundle.lengthMm, lengthUnit), mono: true },
    {
      key: "kg12",
      label: t("bundle.facts.kgPer12ft"),
      value:
        perFoot === null ? (
          "-"
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span data-no-truncate="" className="font-mono">
              {formatKg(perFoot)}
            </span>
            {range !== "noRange" ? <Chip tone={RANGE_TONE[range]}>{t(`status.range.${range}`)}</Chip> : null}
          </span>
        ),
    },
    {
      key: "range",
      label: t("bundle.facts.weightRange"),
      value: perFoot === null ? "-" : formatKg(weightRange12ft(perFoot), 1),
      mono: true,
    },
    ...(band ? [{ key: "band", label: t("bundle.facts.dieBand"), value: band, mono: true }] : []),
    {
      key: "section",
      label: t("bundle.facts.section"),
      value: die ? (
        <Link
          to="/stock/$dieId"
          params={{ dieId: bundle.dieId }}
          className="inline-flex min-h-11 items-center font-semibold text-foreground underline decoration-1 underline-offset-4 hover:decoration-2 pointer-fine:min-h-0"
        >
          {[die.series, die.sectionCode].filter(Boolean).join(" ")}
        </Link>
      ) : (
        "-"
      ),
    },
    ...(die?.name ? [{ key: "die", label: t("bundle.facts.die"), value: die.name }] : []),
    ...(bundle.poNumber ? [{ key: "po", label: t("bundle.facts.po"), value: bundle.poNumber, mono: true }] : []),
    ...(group
      ? [
          {
            key: "session",
            label: t("bundle.facts.session"),
            value: (
              <Link
                to="/pack/$id"
                params={{ id: group.id }}
                className="inline-flex min-h-11 items-center font-mono font-semibold text-foreground underline decoration-1 underline-offset-4 hover:decoration-2 pointer-fine:min-h-0"
              >
                {group.code}
              </Link>
            ),
          },
        ]
      : []),
    { key: "packed", label: t("bundle.facts.packed"), value: packedAt },
  ];

  return (
    <dl
      data-testid="bundle-facts"
      className="m-0 grid grid-cols-2 gap-x-4 gap-y-5 rounded-card border border-border bg-card p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-4"
    >
      {facts.map((f) => (
        <div key={f.key} data-fact={f.key} className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] font-medium leading-5 text-muted-foreground">{f.label}</dt>
          <dd
            // Plain values must show in full. A value with a chip marks its own number (the chip may truncate).
            data-no-truncate={typeof f.value === "string" ? "" : undefined}
            className={`m-0 text-[17px] font-semibold leading-6 break-words tabular-nums ${f.mono ? "font-mono" : ""}`}
          >
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
