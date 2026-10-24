import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { useFieldControl } from "@orrn/ui/components/field";
import { TextArea, type TextAreaProps } from "@orrn/ui/components/input";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import type { Action } from "@/shared/lib/me";

import { masterErrorKey } from "./masters-model";

/** A titled block of a masters page: an `h2`, actions on the right, then its content. */
export function MasterSection({
  id,
  title,
  hint,
  actions,
  children,
  className,
}: {
  id: string;
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="m-0 font-display text-[20px] font-bold leading-tight tracking-[-0.02em] break-words">
            {title}
          </h2>
          {hint ? <p className="m-0 text-[14px] leading-6 text-muted-foreground break-words">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A quiet one-line note on the surface (read-only list, what a state means). */
export function MasterNote({ body, tone = "info", action }: { body: string; tone?: "info" | "attention"; action?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border px-4 py-3",
        tone === "attention" ? "border-tone-amber-ink/30 bg-tone-amber-tint text-tone-amber-ink" : "border-border bg-card",
      )}
    >
      <div className="flex min-w-0 flex-1 basis-[240px] items-start gap-3">
        <Info aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0" />
        <p className={cn("m-0 text-[14px] leading-6 break-words", tone === "info" && "text-muted-foreground")}>{body}</p>
      </div>
      {action}
    </div>
  );
}

/** The list could not load: says so and offers one retry. */
export function MastersLoadError({ onRetry }: { onRetry(): void }) {
  const { t } = useT();
  return (
    <div role="alert" className="rounded-card border border-border bg-card">
      <EmptyState
        title={t("masters.loadFailed")}
        action={
          <Button variant="secondary" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        }
      />
    </div>
  );
}

/** Someone whose role cannot read this list opened it. */
export function MastersNoAccess({ titleKey = "masters.noAccess", bodyKey = "masters.noAccessBody" }: { titleKey?: MessageKey; bodyKey?: MessageKey }) {
  const { t } = useT();
  return (
    <div className="rounded-card border border-border bg-card">
      <EmptyState
        title={t(titleKey)}
        body={t(bodyKey)}
        action={
          <Button asChild variant="secondary">
            <Link to="/today">{t("nav.today")}</Link>
          </Button>
        }
      />
    </div>
  );
}

/** "In use" as plain text, "Retired" as a quiet chip: the status word is always there. */
export function ActiveStatus({ active }: { active: boolean }) {
  const { t } = useT();
  if (!active) return <Chip tone="neutral">{t("masters.status.retired")}</Chip>;
  return <span className="text-[14px] text-muted-foreground">{t("masters.status.inUse")}</span>;
}

export type Show = "active" | "retired" | "all";

export function ShowFilter({ value, onChange }: { value: Show; onChange(v: Show): void }) {
  const { t } = useT();
  return (
    <SegmentedControl<Show>
      label={t("masters.show")}
      value={value}
      onChange={onChange}
      options={[
        { value: "active", label: t("masters.showInUse") },
        { value: "retired", label: t("masters.showRetired") },
        { value: "all", label: t("masters.showAll") },
      ]}
    />
  );
}

export function filterByShow<T extends { active: boolean }>(rows: readonly T[], show: Show): T[] {
  return rows.filter((r) => show === "all" || (show === "active" ? r.active : !r.active));
}

/** The server's refusal in the person's language. */
export function useMasterError() {
  const { t } = useT();
  return (error: unknown) => {
    const view = masterErrorKey(error);
    return t(view.key, view.vars);
  };
}

export function FormError({ error }: { error: unknown }) {
  const message = useMasterError();
  if (!error) return null;
  return (
    <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
      {message(error)}
    </p>
  );
}

/**
 * The first cell of a masters row for people who may edit it: a real button that opens the edit
 * sheet, labelled with the row's name (its accessible name says "Edit ..."). Readers get plain text.
 */
export function RowEdit({
  editable,
  label,
  onEdit,
  children,
  mono,
}: {
  editable: boolean;
  label: string;
  onEdit(): void;
  children: ReactNode;
  mono?: boolean;
}) {
  const { t } = useT();
  const text = (
    <span className={cn("break-words", mono && "font-mono whitespace-nowrap tabular-nums")}>{children}</span>
  );
  if (!editable) return <span className="font-semibold text-foreground">{text}</span>;
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-haspopup="dialog"
      aria-label={t("masters.edit", { name: label })}
      className="-mx-1 inline-flex min-h-11 max-w-full items-center rounded-input px-1 text-left font-semibold text-foreground underline decoration-border decoration-2 underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:decoration-foreground"
    >
      {text}
    </button>
  );
}

/**
 * Add/edit sheet shared by every master: the form, an inline error, the Save button (inside
 * `<Can>`) and, when editing, Retire / Bring back with one line on what that means.
 */
export function MasterSheet({
  open,
  onOpenChange,
  title,
  description,
  formId,
  onSubmit,
  busy,
  error,
  saveLabel,
  editors,
  retire,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  formId: string;
  onSubmit(e: FormEvent): void;
  busy: boolean;
  error: unknown;
  saveLabel: string;
  editors: Action | readonly Action[];
  retire?: { active: boolean; hint: string; retireLabel?: string; onToggle(): void };
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Can do={editors}>
            <Button type="submit" form={formId} size="lg" loading={busy}>
              {saveLabel}
            </Button>
          </Can>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={onSubmit} className="flex flex-col gap-5 pt-1">
        {children}
        <FormError error={error} />
        {retire ? (
          <Can do={editors}>
            <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
              <p className="m-0 text-[14px] leading-6 text-muted-foreground">{retire.hint}</p>
              <Button variant={retire.active ? "ghost" : "secondary"} onClick={retire.onToggle} disabled={busy}>
                {retire.active ? (retire.retireLabel ?? t("masters.retire")) : t("masters.restore")}
              </Button>
            </div>
          </Can>
        ) : null}
      </form>
    </Sheet>
  );
}

/**
 * "Add the standard ..." for an empty master: runs the server's idempotent seed (it skips what
 * exists) and says how many entries landed. With `confirm`, a dialog explains the consequence first.
 */
export function SeedButton({
  label,
  run,
  confirm,
  variant = "primary",
}: {
  label: string;
  run(): Promise<number>;
  confirm?: { title: string; body: string };
  variant?: "primary" | "secondary";
}) {
  const { t } = useT();
  const message = useMasterError();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const added = await run();
      toast.success(added > 0 ? t("masters.seeded", { count: added }) : t("masters.seededNone"));
      setAsking(false);
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Can do="masters.publish">
      <Button
        variant={variant}
        loading={busy && !confirm}
        aria-haspopup={confirm ? "dialog" : undefined}
        onClick={() => (confirm ? setAsking(true) : void go())}
      >
        {label}
      </Button>
      {confirm ? (
        <Dialog
          open={asking}
          onOpenChange={(o) => !busy && setAsking(o)}
          title={confirm.title}
          description={confirm.body}
          actions={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void go()} loading={busy}>
                {label}
              </Button>
            </>
          }
        />
      ) : null}
    </Can>
  );
}

/** A multi-line text field that picks up its `Field` label, hint and error. */
export function FieldTextArea({ id, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest }: TextAreaProps) {
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid });
  return <TextArea {...a11y} {...rest} />;
}

/** The company's calendar day as YYYY-MM-DD (its time zone setting, else the device's). */
export function companyToday(timeZone: unknown, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: typeof timeZone === "string" && timeZone ? timeZone : undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}
