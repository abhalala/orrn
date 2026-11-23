/** Small pieces the billing screens share: the section tabs, the status chip, rupee text and the "today" date. */
import { rupeesText } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { companyToday } from "@orrn/server/lib/purchase";
import { useNavigate } from "@tanstack/react-router";

import { useMe } from "@/shared/lib/me";

import { statusTone, type DocKind, type DocStatus } from "./model";

export type BillingSection = "invoices" | "new" | "payments" | "outstanding" | "settings";

const PATHS: Record<BillingSection, string> = {
  invoices: "/billing",
  new: "/billing/new",
  payments: "/billing/payments",
  outstanding: "/billing/outstanding",
  settings: "/billing/settings",
};

/** The five billing screens as one row of tabs (the page you are on is picked). */
export function BillingTabs({ current }: { current: BillingSection }) {
  const { t } = useT();
  const navigate = useNavigate();
  return (
    <SegmentedControl
      label={t("bill.tabs.label")}
      value={current}
      onChange={(next) => void navigate({ to: PATHS[next] as never })}
      options={(Object.keys(PATHS) as BillingSection[]).map((k) => ({ value: k, label: t(`bill.tabs.${k}`) }))}
    />
  );
}

export function StatusChip({ status, kind }: { status: DocStatus; kind?: DocKind }) {
  const { t } = useT();
  const word = t(`bill.status.${status}`);
  return (
    <Chip tone={statusTone(status)} truncate={false} title={kind === "credit_note" ? t("bill.kind.credit_note") : undefined}>
      {word}
    </Chip>
  );
}

/** Rupees with Indian grouping and two decimals, in the number font. */
export function Rupees({ paise, className }: { paise: number; className?: string }) {
  return <span className={`font-mono tabular-nums whitespace-nowrap ${className ?? ""}`}>{rupeesText(paise)}</span>;
}

/** Today's book date on the plant's wall clock. */
export function useToday(): string {
  const { data: me } = useMe();
  return companyToday(me?.company?.settings ?? null, new Date());
}

/** The words of a refused call, the way the neighbouring office screens show them. */
export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
