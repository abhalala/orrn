import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";

export function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 min-w-0 text-[17px] font-semibold tabular-nums", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

export function FactGrid({ children }: { children: ReactNode }) {
  return <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3">{children}</dl>;
}
