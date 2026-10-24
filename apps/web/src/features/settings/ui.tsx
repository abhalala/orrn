import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useId, type ReactNode } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

/**
 * The plant's settings for the Settings tabs (`company.getSettings`: floor settings with defaults
 * filled, modules, and today's production day). Every tab that reads settings shares this query
 * key, so a save in one tab refreshes the others.
 */
export function usePlantSettings() {
  return useQuery({ ...trpc.company.getSettings.queryOptions(), meta: INLINE_ERROR_META });
}

export type PlantSettings = NonNullable<ReturnType<typeof usePlantSettings>["data"]>;

/** Loading shape and failed-load card shared by the tabs. */
export function TabState({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean; data: unknown; refetch(): unknown };
  children: ReactNode;
}) {
  const { t } = useT();
  if (query.isPending) return <Skeleton className="h-40 w-full rounded-card" aria-busy="true" />;
  if (query.isError && query.data === undefined) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("settings.loadFailed")}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * A labelled on/off switch (`role="switch"`): the whole row is one button, 44 px tall at least,
 * and the state is written ("On"/"Off") as well as drawn. The label and hint name the button.
 */
export function SwitchRow({
  label,
  hint,
  on,
  onToggle,
  disabled,
  pending,
  testId,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle(): void;
  disabled?: boolean;
  pending?: boolean;
  testId?: string;
}) {
  const { t } = useT();
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="min-w-0 flex-1 basis-56">
        <p id={labelId} className="m-0 text-[15px] leading-6 font-semibold break-words">
          {label}
        </p>
        <p id={hintId} className="m-0 text-[13px] leading-5 text-muted-foreground break-words">
          {hint}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        data-testid={testId}
        disabled={disabled || pending}
        onClick={onToggle}
        className={cn(
          "inline-flex h-11 min-w-[88px] shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-60",
          on ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-surface-sunken",
        )}
      >
        <span aria-hidden="true" className={cn("size-2.5 rounded-full", on ? "bg-primary-foreground" : "bg-muted-foreground")} />
        {on ? t("settings.modules.on") : t("settings.modules.off")}
      </button>
    </div>
  );
}

/** One quiet line under a form: why the form is read-only, or what a change does. */
export function Note({ children, testId, role }: { children: ReactNode; testId?: string; role?: "status" | "alert" }) {
  return (
    <p data-testid={testId} role={role} className="m-0 text-[13px] leading-5 text-muted-foreground break-words">
      {children}
    </p>
  );
}
