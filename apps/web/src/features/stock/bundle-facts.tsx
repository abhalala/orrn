import { formatKg, formatLength, gToKg, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { bandText, driftChipTone, driftText, kg12Text, positionKey, positionTone, type ServerDriftTone, type ServerPosition } from "@/features/pack/line-preview";
import { partyNoLabel } from "@/features/pack/party";

type Fact = { key: string; label: string; value: ReactNode; mono?: boolean };

/** The server's band verdict for the bundle (`bundle.getBySerial().band`, D15). */
export type BundleBandView = {
  source: "copy" | "section" | null;
  minG: number | null;
  maxG: number | null;
  position: ServerPosition;
  tone: ServerDriftTone;
  percentTenths: number | null;
};

/**
 * The bundle's facts on a white card (spec §3 `/b/:serial`): weight in kg, pieces, cut length in the
 * company unit, kg/12ft with its band chip and drift, the billed weight range /12', the section,
 * party number, yard, die copy, cast, order, PO, packing session and when it was packed. The chip and
 * drift are the SERVER's verdict (the same one the pack line and the stock lists show), never worked
 * out here. Links are 44 px tall on touch (spec §2).
 */
export function BundleFacts({
  bundle,
  die,
  group,
  band,
  range12ft,
  location,
  dieCopy,
  cast,
  order,
  packedFor,
  lengthUnit,
  packedAt,
}: {
  bundle: {
    weightG: number;
    quantity: number;
    lengthMm: number;
    poNumber: string | null;
    dieId: string;
    serial: string;
    partyNo: string | null;
    /** The printed sticker carries an old party number (a move renumbered the bundle). */
    stickerStale?: boolean;
    kgPer12ftMilli: number | null;
    weightSource?: string | null;
    weightOverrideReason?: string | null;
    bisStandard?: string | null;
    cmlNo?: string | null;
  };
  die: { series: string; sectionCode: string; name: string | null } | null;
  group: { id: string; code: string } | null;
  band: BundleBandView;
  range12ft: number | null;
  location: { id: string; code: string; name: string } | null;
  dieCopy: { id: string; code: string } | null;
  cast: { id: string; number: string } | null;
  order: { orderNumber: string; lineNo: number; customerName: string } | null;
  packedFor: { orderNumber: string; lineNo: number; customerName: string } | null;
  lengthUnit: LengthUnit;
  packedAt: string;
}) {
  const { t } = useT();
  const k12 = kg12Text(bundle.kgPer12ftMilli);
  const key = positionKey(band.position);
  const chip = driftChipTone(band.tone);
  const drift = driftText(band.percentTenths);
  const party = partyNoLabel(bundle);
  const bandRange = band.minG != null && band.maxG != null ? bandText({ minG: band.minG, maxG: band.maxG }) : null;

  const facts: Fact[] = [
    { key: "weight", label: t("bundle.facts.weight"), value: `${formatKg(gToKg(bundle.weightG))} kg`, mono: true },
    { key: "pieces", label: t("bundle.facts.pieces"), value: String(bundle.quantity), mono: true },
    { key: "length", label: t("bundle.facts.cutLength"), value: formatLength(bundle.lengthMm, lengthUnit), mono: true },
    {
      key: "kg12",
      label: t("bundle.facts.kgPer12ft"),
      value:
        k12 === null ? (
          "-"
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span data-no-truncate="" className="font-mono">
              {k12}
            </span>
            {key ? (
              <Chip tone={positionTone(band.position)} data-testid="band-chip" data-verdict={band.position}>
                {t(key)}
              </Chip>
            ) : null}
            {chip && drift ? (
              <Chip tone={chip} data-testid="drift-chip" data-drift-tone={band.tone}>
                {t("pack.new.drift", { percent: drift })}
              </Chip>
            ) : null}
          </span>
        ),
    },
    {
      key: "range",
      label: t("bundle.facts.weightRange"),
      value: range12ft === null ? "-" : formatKg(range12ft, 1),
      mono: true,
    },
    ...(bandRange
      ? [
          {
            key: "band",
            label: band.source === "copy" ? t("bundle.facts.copyBand") : t("bundle.facts.dieBand"),
            value: bandRange,
            mono: true,
          },
        ]
      : []),
    ...(party ? [{ key: "party", label: t("pack.partyNo"), value: party, mono: true }] : []),
    ...(bundle.stickerStale
      ? [
          {
            key: "sticker",
            label: t("pack.stickerStale"),
            value: (
              <span className="flex flex-col gap-1.5" data-testid="sticker-stale">
                <Chip tone="amber">{t("pack.stickerStale")}</Chip>
                <span className="text-[14px] font-medium text-muted-foreground">{t("pack.stickerStaleHint")}</span>
              </span>
            ),
          },
        ]
      : []),
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
    ...(dieCopy ? [{ key: "copy", label: t("pack.source.copy"), value: dieCopy.code, mono: true }] : []),
    ...(cast ? [{ key: "cast", label: t("pack.source.cast"), value: cast.number, mono: true }] : []),
    {
      key: "location",
      label: t("bundle.facts.location"),
      value: location ? location.code : t("bundle.facts.noLocation"),
      mono: Boolean(location),
    },
    {
      key: "order",
      label: t("pack.forOrder"),
      value: order ? (
        <span className="flex flex-col">
          <span className="font-mono">{`${order.orderNumber}/${order.lineNo}`}</span>
          <span className="text-[14px] font-medium text-muted-foreground">{order.customerName}</span>
        </span>
      ) : (
        t("pack.plantStock")
      ),
    },
    ...(packedFor
      ? [
          {
            key: "packedFor",
            label: t("bundle.facts.packedFor"),
            value: <span className="font-mono">{`${packedFor.orderNumber}/${packedFor.lineNo}`}</span>,
          },
        ]
      : []),
    ...(bundle.bisStandard
      ? [{ key: "standard", label: t("pack.standard"), value: [bundle.bisStandard, bundle.cmlNo ? `CM/L ${bundle.cmlNo}` : ""].filter(Boolean).join(" · ") }]
      : []),
    ...(bundle.weightSource === "manual" && bundle.weightOverrideReason
      ? [{ key: "typed", label: t("bundle.facts.typedWeight"), value: bundle.weightOverrideReason }]
      : []),
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
