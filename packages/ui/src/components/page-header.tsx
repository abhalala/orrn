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
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1.5">
        {eyebrow ? (
          <p className="m-0 text-[13px] font-medium text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="orrn-page-title m-0 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.035em] text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="orrn-page-description m-0 max-w-[680px] text-[15px] leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <PageActions>{actions}</PageActions> : null}
    </div>
  );
}
