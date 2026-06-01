// @ts-nocheck — Bun resolves `react-native` to a different install for packages/ui
// vs apps/native (the peer-dep context differs), so cross-workspace type
// equality fails even though both copies are identical at runtime. Metro+Babel
// handle JSX, NativeWind augments `className`, and tests run against
// apps/native's install — disabling the inner typecheck here is safe.
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type PressableProps } from "react-native";

import { cn } from "@orrn/ui/lib/utils";

/**
 * ORRN Button — native (RN + NativeWind) implementation. Mirrors the prop
 * surface of the web Button so cross-platform screens compile against a
 * single shape. NativeWind translates the `className` strings into native
 * styles.
 */
const containerVariants = cva(
  "flex-row items-center justify-center gap-2 rounded-md",
  {
    variants: {
      variant: {
        default: "bg-primary",
        outline: "border border-border bg-transparent",
        secondary: "bg-secondary",
        ghost: "bg-transparent",
        destructive: "bg-destructive",
        link: "bg-transparent",
      },
      size: {
        xs: "h-7 px-2",
        sm: "h-8 px-3",
        default: "h-9 px-4",
        lg: "h-11 px-6",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const textVariants = cva("text-sm font-medium", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      outline: "text-foreground",
      secondary: "text-secondary-foreground",
      ghost: "text-foreground",
      destructive: "text-destructive-foreground",
      link: "text-primary underline",
    },
    size: {
      xs: "text-xs",
      sm: "text-xs",
      default: "text-sm",
      lg: "text-sm",
      icon: "text-sm",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonVariant = NonNullable<VariantProps<typeof containerVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof containerVariants>["size"]>;

export type ButtonProps = Omit<PressableProps, "children"> &
  VariantProps<typeof containerVariants> & {
    asChild?: boolean;
    loading?: boolean;
    /** Web parity — calls Pressable.onPress when invoked. */
    onClick?: (e: any) => void;
    className?: string;
    children?: ReactNode;
  };

export const Button = forwardRef<View, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, onPress, onClick, children, ...rest },
  ref,
) {
  return (
    <Pressable
      ref={ref as any}
      disabled={disabled || loading || undefined}
      onPress={(e) => {
        onPress?.(e);
        onClick?.(e as any);
      }}
      className={cn(
        containerVariants({ variant, size }),
        (disabled || loading) && "opacity-55",
        className,
      )}
      {...rest}
    >
      {loading ? <ActivityIndicator size="small" /> : null}
      {typeof children === "string" ? (
        <Text className={textVariants({ variant, size })}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
});

/** No-op CVA stub kept for backwards compat with web call sites. */
export const buttonVariants = (_opts?: { variant?: ButtonVariant; size?: ButtonSize }) => "";
