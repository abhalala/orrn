import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Info } from "lucide-react";
import type { ReactNode } from "react";

/** Store item page path (ids are uuids; encoded anyway). */
export function storeItemPath(id: string): string {
  return `/store/items/${encodeURIComponent(id)}`;
}

/** A titled block of a store page: an `h2` and its content, with optional actions on the right. */
export function StoreSection({
  id,
  title,
  actions,
  children,
  className,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 id={id} className="m-0 font-display text-[20px] font-bold leading-tight tracking-[-0.02em] break-words">
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A quiet one-line note on the surface (read-only access, setup still needed). */
export function StoreNote({
  title,
  body,
  tone = "info",
}: {
  title?: string;
  body: string;
  tone?: "info" | "attention";
}) {
  const Icon = tone === "attention" ? AlertCircle : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-card border px-4 py-3.5",
        tone === "attention"
          ? "border-tone-amber-ink/30 bg-tone-amber-tint text-tone-amber-ink"
          : "border-border bg-card",
      )}
    >
      <Icon aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <p className="m-0 text-[15px] font-semibold leading-snug break-words">{title}</p> : null}
        <p className={cn("m-0 text-[14px] leading-6 break-words", tone === "info" && "text-muted-foreground")}>
          {body}
        </p>
      </div>
    </div>
  );
}

/** The page could not load: says so and offers one retry. */
export function StoreLoadError({ onRetry }: { onRetry(): void }) {
  const { t } = useT();
  return (
    <div role="alert" className="rounded-card border border-border bg-card">
      <EmptyState
        title={t("store.loadFailed")}
        action={
          <Button variant="secondary" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        }
      />
    </div>
  );
}

/** Someone without store access opened a store page. */
export function StoreNoAccess({ entries = false }: { entries?: boolean }) {
  const { t } = useT();
  return (
    <div className="rounded-card border border-border bg-card">
      <EmptyState
        title={entries ? t("store.noEntryAccess") : t("store.noAccess")}
        body={entries ? t("store.noEntryAccessBody") : t("store.noAccessBody")}
        action={
          <Button asChild variant="secondary">
            {entries ? <Link to="/store">{t("store.backToStore")}</Link> : <Link to="/today">{t("nav.today")}</Link>}
          </Button>
        }
      />
    </div>
  );
}
