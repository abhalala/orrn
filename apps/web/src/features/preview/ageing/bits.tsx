import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export function Fact({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[12px] font-medium leading-4 text-muted-foreground">{label}</dt>
      <dd className="m-0 break-words font-mono text-[15px] leading-5 tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export function FactGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("m-0 grid grid-cols-2 gap-x-3 gap-y-3", className)}>{children}</dl>;
}
