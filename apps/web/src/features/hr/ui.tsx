/** Small pieces the People screens share: the section tabs, the module guard, the month picker, tone chips and the plant's "today". */
import { isModuleOn, readFloorSettings, type Shift } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import { companyToday } from "@orrn/server/lib/purchase";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { can, canAny, useMe, type Action } from "@/shared/lib/me";

import { shiftMonth } from "./model";

export type HrSection = "people" | "attendance" | "roster" | "timesheet" | "leave" | "training" | "recruitment" | "devices" | "incentive" | "settings";

type SectionDef = { key: HrSection; to: string; label: MessageKey; requires: readonly Action[] };

const VIEW: readonly Action[] = ["hr.view"];

/** The People screens, in tab order; each shows for the people the screen lets in. */
export const HR_SECTIONS: readonly SectionDef[] = [
  { key: "people", to: "/hr", label: "hr.tabs.people", requires: VIEW },
  { key: "attendance", to: "/hr/attendance", label: "hr.tabs.attendance", requires: ["hr.view", "attendance.mark"] },
  { key: "roster", to: "/hr/roster", label: "hr.tabs.roster", requires: ["hr.view", "attendance.mark"] },
  { key: "timesheet", to: "/hr/timesheet", label: "hr.tabs.timesheet", requires: VIEW },
  { key: "leave", to: "/hr/leave", label: "hr.tabs.leave", requires: ["hr.view", "leave.approve"] },
  { key: "training", to: "/hr/training", label: "hr.tabs.training", requires: VIEW },
  { key: "recruitment", to: "/hr/recruitment", label: "hr.tabs.recruitment", requires: VIEW },
  { key: "devices", to: "/hr/devices", label: "hr.tabs.devices", requires: ["hr.view", "attendance.manage"] },
  { key: "incentive", to: "/hr/incentive", label: "hr.tabs.incentive", requires: VIEW },
  { key: "settings", to: "/hr/settings", label: "hr.tabs.settings", requires: VIEW },
];

export function HrTabs({ current }: { current: HrSection }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const items = HR_SECTIONS.filter((s) => canAny(me, s.requires));
  return (
    <Tabs
      label={t("hr.tabs.label")}
      items={items.map((s) => ({ id: s.key, label: t(s.label) }))}
      value={current}
      onValueChange={(next) => {
        const to = HR_SECTIONS.find((s) => s.key === next)?.to;
        if (to) void navigate({ to: to as never });
      }}
    />
  );
}

/** The module and the role gate of a People screen: `hr` off or the role too low shows a plain sentence, never a broken page. */
export function HrGate({ children, needs }: { children: ReactNode; needs?: readonly Action[] }) {
  const { t } = useT();
  const { data: me, isPending } = useMe();
  if (isPending) return <Skeleton className="h-64 w-full rounded-card" />;
  if (!isModuleOn(me?.company?.modules, "hr")) return <EmptyState title={t("hr.moduleOff")} />;
  if (needs && !canAny(me, needs)) return <EmptyState title={t("hr.noAccess")} />;
  return <>{children}</>;
}

/** The plant's book date for today. */
export function useToday(): string {
  const { data: me } = useMe();
  return companyToday(me?.company?.settings ?? null, new Date());
}

export function useCan(action: Action): boolean {
  const { data: me } = useMe();
  return can(me, action);
}

/** The words of a refused call, the way the neighbouring office screens show them. */
export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** "Nov 2026" in the person's language (the twelve short month names are `reports.monthsShort`). */
export function useMonthLabel(): (month: string) => string {
  const { t } = useT();
  const months = t("reports.monthsShort").split(",");
  return (month) => {
    const [y, m] = month.split("-").map(Number);
    return y && m && months[m - 1] ? `${months[m - 1]} ${y}` : month;
  };
}

/** "Earlier / month / later": a month stepper with the month name in the middle. */
export function MonthStepper({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { t } = useT();
  const label = useMonthLabel()(month);
  return (
    <div className="flex items-center gap-2">
      <IconButton label={t("hr.month.prev")} icon={<ChevronLeft aria-hidden="true" />} variant="secondary" onClick={() => onChange(shiftMonth(month, -1))} />
      <span className="min-w-28 text-center text-[15px] font-semibold">{label}</span>
      <IconButton label={t("hr.month.next")} icon={<ChevronRight aria-hidden="true" />} variant="secondary" onClick={() => onChange(shiftMonth(month, 1))} />
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  return (
    <EmptyState
      title={t("hr.loadFailed")}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      }
    />
  );
}

/** A section card: a heading, a hint line and the content. */
export function Section({ id, title, hint, actions, children }: { id: string; title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="m-0 text-[15px] font-semibold">
            {title}
          </h2>
          {hint ? <p className="m-0 text-[13px] text-muted-foreground">{hint}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** The plant's named shifts, in order. */
export function usePlantShifts(): Shift[] {
  const { data: me } = useMe();
  return [...readFloorSettings(me?.company?.settings).shifts].sort((a, b) => a.seq - b.seq);
}

/** A value that follows `value` after it has stood still for `ms` (a search box that does not ask the server per key). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export type PickOption = { value: string; label: string };

/** A platform select tied to its `Field` (label, hint and error), for short lists. */
export function Pick({ value, onChange, options, disabled, compact, "aria-label": ariaLabel }: { value: string; onChange: (v: string) => void; options: readonly PickOption[]; disabled?: boolean; compact?: boolean; "aria-label"?: string }) {
  const a11y = useFieldControl();
  return (
    <NativeSelect {...a11y} aria-label={ariaLabel} density={compact ? "compact" : "default"} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}
