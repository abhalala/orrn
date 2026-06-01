import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({ title, description, actions, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-5 py-8">
      {icon ? <div className="opacity-60">{icon}</div> : null}
      <h4 className="m-0 text-center text-base font-semibold">{title}</h4>
      {description ? (
        <p className="m-0 max-w-[420px] text-center text-sm text-muted-foreground">{description}</p>
      ) : null}
      {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
