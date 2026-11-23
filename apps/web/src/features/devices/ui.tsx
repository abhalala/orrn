import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import type { DeviceHealth } from "@orrn/domain";
import { useId, type ReactNode } from "react";

import { useDevError } from "./hooks";
import { healthTone } from "./model";

/** The failed write's sentence, where the action is (never `error.message`). */
export function DevErrorNote({ error, className }: { error: unknown; className?: string }) {
  const say = useDevError();
  if (!error) return null;
  return (
    <p role="alert" data-testid="dev3-error" className={cn("m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium break-words text-tone-red-ink", className)}>
      {say(error)}
    </p>
  );
}

export function HealthChip({ health }: { health: DeviceHealth }) {
  const { t } = useT();
  return (
    <Chip tone={healthTone(health)} truncate={false} data-health={health}>
      {t(`dev3.health.${health}`)}
    </Chip>
  );
}

/** Marks a simulated device or reading. Nothing simulated may look live. */
export function SimBadge({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <Chip tone="blue" dot={false} truncate={false} title={t("dev3.simTitle")} data-testid="dev3-sim" className={className}>
      {t("dev3.sim")}
    </Chip>
  );
}

export function Block({ id, title, hint, actions, children, className }: { id: string; title: string; hint?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="m-0 font-display text-[20px] leading-tight font-bold tracking-[-0.02em] break-words">
            {title}
          </h2>
          {hint ? <p className="m-0 text-[14px] leading-6 break-words text-muted-foreground">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A sheet around one form: Cancel, the primary button, and the failed write's sentence inside it. */
export function DevFormSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  busy,
  error,
  submitLabel,
  testId,
  children,
  hideCancel,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  onSubmit(): void;
  busy: boolean;
  error: unknown;
  submitLabel: string;
  testId?: string;
  children: ReactNode;
  hideCancel?: boolean;
}) {
  const { t } = useT();
  const formId = `dev3-form-${useId().replace(/:/g, "")}`;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}
      title={title}
      description={description}
      dismissible={!busy}
      footer={
        <>
          {hideCancel ? null : (
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
          )}
          <Button type="submit" form={formId} size="lg" loading={busy} data-testid={testId ? `${testId}-submit` : undefined}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        data-testid={testId}
        className="flex flex-col gap-5 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        {children}
        <DevErrorNote error={error} />
      </form>
    </Sheet>
  );
}

export function DevSelect({ id, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest }: React.ComponentProps<typeof NativeSelect>) {
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid });
  return <NativeSelect {...rest} {...a11y} />;
}
