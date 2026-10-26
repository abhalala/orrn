import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type EmptyStateProps = {
  title: string;
  /** One sentence. */
  body?: string;
  /** One button that starts the next step. */
  action?: ReactNode;
  className?: string;
  /** @deprecated use `body` */
  description?: ReactNode;
  /** @deprecated use `action` (one action) */
  actions?: ReactNode;
  /** @deprecated C2 empty states have no icon */
  icon?: ReactNode;
};

/**
 * Empty list or "not found" state: a title, one sentence and one action that
 * invites the next step. Sits quietly on the surface it is placed in.
 */
export function EmptyState({ title, body, action, className, description, actions, icon }: EmptyStateProps) {
  const text = body ?? description;
  const act = action ?? actions;
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center justify-center gap-2 px-5 py-12 text-center", className)}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-2 flex size-14 items-center justify-center rounded-card bg-surface-sunken text-foreground [&_svg]:size-6"
        >
          {icon}
        </div>
      ) : null}
      <p className="m-0 font-display text-xl font-bold leading-tight tracking-[-0.025em] text-foreground">{title}</p>
      {text ? <p className="m-0 max-w-[420px] text-[15px] leading-6 text-muted-foreground">{text}</p> : null}
      {act ? <div className="mt-3 flex flex-wrap justify-center gap-2">{act}</div> : null}
    </div>
  );
}
