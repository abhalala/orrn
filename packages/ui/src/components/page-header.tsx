import type { ReactNode } from "react";

import { PageActions } from "./app-frame";

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
};

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {eyebrow ? (
          <p className="m-0 text-[11px] uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="orrn-page-title m-0 text-2xl font-semibold leading-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="orrn-page-description m-0 max-w-[680px] text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <PageActions>{actions}</PageActions> : null}
    </div>
  );
}
