/**
 * Small shared pieces of the purchase screens: the lot status chip, the kanta
 * difference in words, and the company settings the screens read (D/C
 * tolerance, today's book date) from `auth.me`.
 */
import type { Fmt } from "@orrn/domain";
import { useFmt } from "@/shared/lib/fmt";
import { useT, type Translate } from "@orrn/i18n";
import { companyToday, dcToleranceBp } from "@orrn/server/lib/purchase";
import { Chip } from "@orrn/ui/components/chip";
import { cn } from "@orrn/ui/lib/utils";

import { can, useMe } from "@/shared/lib/me";

import { pctText } from "./format";
import type { KantaReading } from "./kanta";
import { LOT_TONE, type LotPerms, type LotStatus } from "./lot-view";
import { kgTrim } from "@/shared/lib/fmt-text";

export function LotStatusChip({ status }: { status: LotStatus }) {
  const { t } = useT();
  return <Chip tone={LOT_TONE[status]}>{t(`purchase.lotStatus.${status}`)}</Chip>;
}

/** The difference in words: "220 kg short, beyond 0.5%". The words carry the verdict, not only colour. */
export function diffText(t: Translate, reading: KantaReading, toleranceBp: number, fmt: Fmt): string {
  const pct = pctText(toleranceBp);
  switch (reading.state) {
    case "incomplete":
      return t("purchase.diff.incomplete");
    case "even":
      return t("purchase.diff.even");
    case "over":
      return t("purchase.diff.over", { kg: kgTrim(fmt, reading.diffG ?? 0) });
    case "within":
      return t("purchase.diff.within", { kg: kgTrim(fmt, reading.shortG), pct });
    case "short":
      return t("purchase.diff.short", { kg: kgTrim(fmt, reading.shortG), pct });
  }
}

/**
 * Inline difference: red ink and semibold when short beyond the tolerance (live feedback while
 * weighing). `quiet` keeps it muted always, for lists, where a chip names what needs action.
 */
export function DiffText({
  reading,
  toleranceBp,
  quiet,
  className,
}: {
  reading: KantaReading;
  toleranceBp: number;
  quiet?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const fmt = useFmt();
  return (
    <span
      className={cn(
        "break-words",
        reading.state === "short" && !quiet ? "font-semibold text-tone-red-ink" : "text-muted-foreground",
        className,
      )}
    >
      {diffText(t, reading, toleranceBp, fmt)}
    </span>
  );
}

export function useLotPerms(): LotPerms {
  const { data: me } = useMe();
  return {
    receipt: can(me, "purchase.receipt"),
    dcnote: can(me, "purchase.dcnote"),
    publish: can(me, "masters.publish"),
  };
}

/** The company's D/C tolerance (settings.dcTolerancePct in basis points, default 50). */
export function useToleranceBp(): number {
  const { data: me } = useMe();
  return dcToleranceBp(me?.company?.settings ?? null);
}

/** Today's book date on the company's wall clock. */
export function useCompanyToday(): string {
  const { data: me } = useMe();
  return companyToday(me?.company?.settings ?? null, new Date());
}
