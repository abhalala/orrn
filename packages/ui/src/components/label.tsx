import type { ReactNode } from "react";

import { Label as TgLabel } from "@orrn/ui/lib/tg";

export type LabelProps = Record<string, any> & {
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
};

export function Label({ className: _className, ...props }: LabelProps) {
  return (
    <TgLabel
      fontSize={12}
      fontWeight="500"
      color="$color"
      lineHeight={16}
      paddingVertical={2}
      {...props}
    />
  );
}
