import { forwardRef, type MouseEvent, type ReactNode } from "react";

import { Button as TgButton, Spinner } from "@orrn/ui/lib/tg";

/**
 * ORRN Button. Cross-platform Tamagui primitive. Supports the same
 * `variant`/`size` API the old shadcn button used so screen migration is a
 * near find-and-replace.
 *
 * Web callers can pass `onClick`; we forward it to Tamagui's `onPress`.
 */
export type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "xs" | "sm" | "default" | "lg" | "icon";

const VARIANT_STYLES: Record<ButtonVariant, Record<string, unknown>> = {
  default: {
    backgroundColor: "$primary",
    color: "$primaryFg",
    borderWidth: 0,
    hoverStyle: { backgroundColor: "$primaryHover" },
    pressStyle: { backgroundColor: "$primaryHover" },
  },
  outline: {
    backgroundColor: "transparent",
    borderColor: "$borderColor",
    borderWidth: 1,
    color: "$color",
    hoverStyle: { backgroundColor: "$backgroundHover" },
    pressStyle: { backgroundColor: "$backgroundPress" },
  },
  secondary: {
    backgroundColor: "$muted",
    color: "$color",
    borderWidth: 0,
    hoverStyle: { backgroundColor: "$backgroundHover" },
  },
  ghost: {
    backgroundColor: "transparent",
    color: "$color",
    borderWidth: 0,
    hoverStyle: { backgroundColor: "$backgroundHover" },
    pressStyle: { backgroundColor: "$backgroundPress" },
  },
  destructive: {
    backgroundColor: "#ef4444",
    color: "#ffffff",
    borderWidth: 0,
    hoverStyle: { backgroundColor: "#dc2626" },
    pressStyle: { backgroundColor: "#dc2626" },
  },
  link: {
    backgroundColor: "transparent",
    color: "$primary",
    borderWidth: 0,
    paddingHorizontal: 0,
    hoverStyle: { backgroundColor: "transparent" },
  },
};

const SIZE_STYLES: Record<ButtonSize, Record<string, unknown>> = {
  xs: { height: 26, paddingHorizontal: 8, fontSize: 11 },
  sm: { height: 30, paddingHorizontal: 10, fontSize: 12 },
  default: { height: 36, paddingHorizontal: 14, fontSize: 13 },
  lg: { height: 44, paddingHorizontal: 18, fontSize: 14 },
  icon: { height: 36, width: 36, paddingHorizontal: 0 },
};

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (e: any) => void;
  /** Web compat — forwarded to Tamagui `onPress`. */
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  className?: string;
  children?: ReactNode;
  [key: string]: any;
};

export const Button = forwardRef<unknown, ButtonProps>(function Button(
  { variant: variantInput, size: sizeInput, loading, onClick, onPress, disabled, children, ...rest },
  ref,
) {
  const variant: ButtonVariant = (variantInput as ButtonVariant) ?? "default";
  const size: ButtonSize = (sizeInput as ButtonSize) ?? "default";
  const variantStyle = VARIANT_STYLES[variant];
  const sizeStyle = SIZE_STYLES[size];
  return (
    <TgButton
      ref={ref as any}
      borderRadius={8}
      fontWeight="500"
      animation="quick"
      cursor="pointer"
      disabled={disabled || loading}
      opacity={disabled || loading ? 0.55 : 1}
      onPress={(e: any) => {
        onPress?.(e);
        onClick?.(e as unknown as MouseEvent<HTMLElement>);
      }}
      {...variantStyle}
      {...sizeStyle}
      {...rest}
    >
      {loading ? <Spinner size="small" color="$color" /> : null}
      {children}
    </TgButton>
  );
});

/**
 * Backwards-compat export: callers used `buttonVariants({ variant, size })` to
 * apply Tailwind classes to non-button elements (e.g. <Link>). We now return
 * an empty string so the call still works without breaking anchor-styling
 * during migration; new code should just use <Button> instead.
 */
export const buttonVariants = (_opts?: { variant?: ButtonVariant; size?: ButtonSize }) => "";
