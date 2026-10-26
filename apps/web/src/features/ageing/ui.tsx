import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { useId, type ReactNode } from "react";

import { useRefusal } from "./hooks";
import { phaseTone, rowTone, soakTone } from "./model";
import type { Batch, BatchRow } from "./hooks";

/** The server's refusal for a failed write, where the action is (never `error.message`). */
export function RefusalNote({ error, className }: { error: unknown; className?: string }) {
  const say = useRefusal();
  if (!error) return null;
  return (
    <p role="alert" data-testid="ageing-refusal" className={cn("m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium break-words text-tone-red-ink", className)}>
      {say(error)}
    </p>
  );
}

export function PhaseChip({ phase }: { phase: Batch["phase"] }) {
  const { t } = useT();
  return (
    <Chip tone={phaseTone(phase)} truncate={false}>
      {t(`ageing.phase.${phase}`)}
    </Chip>
  );
}

export function RowChip({ status }: { status: BatchRow["status"] }) {
  const { t } = useT();
  return (
    <Chip tone={rowTone(status)} truncate={false}>
      {t(`ageing.rowStatus.${status}`)}
    </Chip>
  );
}

export function SoakChip({ verdict }: { verdict: NonNullable<Batch["soak"]>["verdict"] }) {
  const { t } = useT();
  return (
    <Chip tone={soakTone(verdict)} truncate={false}>
      {t(`ageing.soakVerdict.${verdict}`)}
    </Chip>
  );
}

/** A label above a value, for the facts grids. */
export function Fact({ label, children, mono, className }: { label: string; children: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 text-[15px] font-semibold break-words", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}

export function Section({ id, title, hint, actions, children, className }: { id: string; title: string; hint?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
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

export function Panel({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("rounded-card border border-border bg-card p-4 sm:p-5", className)}>
      {children}
    </div>
  );
}

/** A sheet around one form: Cancel, the primary button, and the server's refusal inside it. */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  busy,
  error,
  submitLabel,
  submitDisabled,
  submitTone,
  testId,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  onSubmit(): void;
  busy: boolean;
  error: unknown;
  submitLabel: string;
  submitDisabled?: boolean;
  submitTone?: "primary" | "danger";
  testId?: string;
  children: ReactNode;
}) {
  const { t } = useT();
  const formId = `ageing-form-${useId().replace(/:/g, "")}`;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}
      title={title}
      description={description}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} size="lg" variant={submitTone === "danger" ? "danger" : "primary"} loading={busy} disabled={submitDisabled} data-testid={testId ? `${testId}-submit` : undefined}>
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
        <RefusalNote error={error} />
      </form>
    </Sheet>
  );
}

/** The plant's select inside a `Field`: takes the label's id and the hint and error from the field (the bare one does not). */
export function FieldSelect({ id, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest }: React.ComponentProps<typeof NativeSelect>) {
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid });
  return <NativeSelect {...rest} {...a11y} />;
}
