/** Small pieces the payroll screens share: the section tabs, the state chip, rupee text, the module gate and the people list. */
import { isModuleOn, rupeesText } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { companyToday } from "@orrn/server/lib/purchase";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { stateTone, type RunStatus } from "./model";

export type PayrollSection = "runs" | "people" | "adjustments" | "settings";

const PATHS: Record<PayrollSection, string> = {
  runs: "/payroll",
  people: "/payroll/people",
  adjustments: "/payroll/adjustments",
  settings: "/payroll/settings",
};

/** The four payroll screens as one row of tabs (the page you are on is picked). */
export function PayrollTabs({ current }: { current: PayrollSection }) {
  const { t } = useT();
  const navigate = useNavigate();
  return (
    <SegmentedControl
      label={t("payroll.tabs.label")}
      value={current}
      onChange={(next) => void navigate({ to: PATHS[next] as never })}
      options={(Object.keys(PATHS) as PayrollSection[]).map((k) => ({ value: k, label: t(`payroll.tabs.${k}` as MessageKey) }))}
    />
  );
}

export function StateChip({ status }: { status: RunStatus }) {
  const { t } = useT();
  return (
    <Chip tone={stateTone(status)} truncate={false}>
      {t(`payroll.state.${status}` as MessageKey)}
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

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Payroll needs both modules (`hr` and `payroll`, opt-in) and salary access. The server refuses anything else; this says
 * why on the screen instead of a load error. The read rule is `isModuleOn`, never an "empty list means all" check.
 */
export function PayrollGate({ children, need = "payroll.view" }: { children: ReactNode; need?: "payroll.view" | "leave.apply" }) {
  const { t } = useT();
  const { data: me, isPending } = useMe();
  if (isPending) return <Skeleton className="h-40 w-full rounded-card" />;
  const modules = me?.company?.modules;
  if (!isModuleOn(modules, "hr") || !isModuleOn(modules, "payroll")) return <EmptyState title={t("payroll.off")} />;
  if (!can(me, need)) return <EmptyState title={t("payroll.noAccess")} />;
  return <>{children}</>;
}

/** Everyone on the people list (left included), for the pickers. */
export function usePeopleOptions() {
  return useQuery({ ...trpc.hr.people.options.queryOptions({ includeLeft: true }), staleTime: 60_000 });
}
