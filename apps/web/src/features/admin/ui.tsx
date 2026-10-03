import { useT, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { cn } from "@orrn/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";

/**
 * Small pieces shared by the Godseye screens. Kept here (not in @orrn/ui)
 * until a second area needs them.
 */

type TrpcLike = { data?: { code?: unknown } | null };

/** tRPC error code, or null. */
export function errorCode(error: unknown): string | null {
  const code = error && typeof error === "object" ? (error as TrpcLike).data?.code : null;
  return typeof code === "string" ? code : null;
}

/**
 * A translated sentence for a failed mutation. Server messages are English
 * and technical, so they never reach the screen; known codes get their own
 * copy via `byCode`, FORBIDDEN and network failures the shared copy.
 */
export function errorText(t: Translate, error: unknown, byCode: Partial<Record<string, string>> = {}): string {
  const code = errorCode(error);
  if (code && byCode[code]) return byCode[code]!;
  if (code === "FORBIDDEN") return t("errors.forbidden");
  if (code === "NOT_FOUND") return t("errors.notFound");
  if (!code) return t("errors.network");
  return t("errors.generic");
}

/**
 * White surface card: 16px radius, hairline, no shadow (the screen's blocks
 * carry the colour). `article` for items in a list (cards are not
 * landmarks), `section` (default) for a titled part of the page.
 */
export function Panel({
  as: Tag = "section",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: "section" | "article" | "div" }) {
  return (
    <Tag className={cn("min-w-0 rounded-card border border-border bg-card text-card-foreground", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** A failed load: what happened, how to fix it, one retry. Announced as an alert. */
export function LoadError({ message, onRetry, className }: { message: string; onRetry: () => void; className?: string }) {
  const { t } = useT();
  return (
    <div
      role="alert"
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card px-5 py-4",
        className,
      )}
    >
      <p className="m-0 min-w-0 flex-1 basis-60 text-[15px] leading-6 text-foreground">{message}</p>
      <Button variant="secondary" onPress={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

/**
 * The latest non-null value. A dialog opened for one row (`open={row !== null}`)
 * keeps that row's title while it animates out after the row is cleared,
 * instead of flashing an empty title. Derived state set during render (the
 * React-documented pattern), so no effect and no ref read in render.
 */
export function useLastValue<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  body: string;
  confirmLabel: string;
  /** `danger` for destructive actions (suspend, turn off, remove). */
  tone?: "primary" | "danger";
  pending?: boolean;
  onConfirm(): void;
  children?: ReactNode;
};

/** Confirmation for one irreversible action. Cancel is focused first by Radix (the first button). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  tone = "primary",
  pending = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={title}
      description={body}
      actions={
        <>
          <DialogCloseButton onPress={() => onOpenChange(false)} />
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={pending}
            onPress={onConfirm}
            className="pointer-coarse:h-14"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/** Copy text to the clipboard with a toast either way; returns whether it worked. */
export function useCopy() {
  const { t } = useT();
  return async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("admin.printing.copied", { label }));
      return true;
    } catch {
      toast.error(t("admin.printing.copyFailed"));
      return false;
    }
  };
}

/**
 * A secret or code shown once: label, the value in Geist Mono (wraps
 * anywhere, never cut off), and a Copy button that confirms with a check.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useT();
  const copy = useCopy();
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="m-0 text-[14px] font-semibold leading-5 text-foreground">{label}</p>
      <div className="flex min-w-0 items-start gap-2">
        <code
          data-no-truncate=""
          className="min-w-0 flex-1 rounded-input border border-border bg-surface-sunken px-3 py-2.5 font-mono text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]"
        >
          {value}
        </code>
        <Button
          variant="secondary"
          className="shrink-0"
          aria-label={t("admin.printing.copyValue", { label })}
          onPress={async () => {
            if (await copy(value, label)) {
              setDone(true);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setDone(false), 1600);
            }
          }}
        >
          {done ? <Check aria-hidden="true" strokeWidth={2} /> : <Copy aria-hidden="true" strokeWidth={2} />}
          <span aria-hidden="true">{done ? t("common.copied") : t("common.copy")}</span>
        </Button>
      </div>
    </div>
  );
}

/** A label/value pair in a facts strip (`dl`). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-[15px] font-semibold text-foreground break-words">{children}</dd>
    </div>
  );
}
