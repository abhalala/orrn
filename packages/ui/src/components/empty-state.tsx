import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({ title, description, actions, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center">
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-1 flex size-14 items-center justify-center rounded-card bg-surface-sunken text-foreground [&_svg]:size-6"
        >
          {icon}
        </div>
      ) : null}
      <h4 className="m-0 font-display text-xl font-bold tracking-[-0.025em] text-foreground">{title}</h4>
      {description ? (
        <p className="m-0 max-w-[420px] text-[15px] leading-6 text-muted-foreground">{description}</p>
      ) : null}
      {actions ? <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
