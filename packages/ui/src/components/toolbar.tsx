import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type ToolbarProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  actions?: ReactNode;
};

export function Toolbar({ children, actions, className, ...rest }: ToolbarProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-3" {...rest}>
        <div className="flex min-w-[200px] flex-1 flex-wrap items-center gap-2">{children}</div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
