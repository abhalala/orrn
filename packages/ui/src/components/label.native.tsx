// @ts-nocheck — Bun resolves `react-native` to a different install for packages/ui
// vs apps/native; cross-workspace type equality fails. Metro+Babel bundle this
// correctly and NativeWind augments `className`, so disabling the inner
// typecheck is safe.
import type { ReactNode } from "react";
import { Text, type TextProps } from "react-native";

import { cn } from "@orrn/ui/lib/utils";

export type LabelProps = TextProps & {
  /** Web parity — ignored on native (RN has no for/id binding). */
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
};

export function Label({ className, htmlFor: _htmlFor, ...props }: LabelProps) {
  return (
    <Text
      className={cn("py-0.5 text-xs font-medium text-foreground", className)}
      {...props}
    />
  );
}
