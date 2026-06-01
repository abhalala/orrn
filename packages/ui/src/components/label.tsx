import * as LabelPrimitive from "@radix-ui/react-label";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type LabelProps = ComponentPropsWithoutRef<typeof LabelPrimitive.Root>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...props },
  ref,
) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      data-slot="label"
      className={cn(
        "text-xs font-medium leading-4 text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
});
