import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

/**
 * C2 Button: a pill. Web implementation (Radix Slot + Tailwind); the native
 * twin (`button.native.tsx`) keeps the same prop surface.
 *
 * Variants: `primary` (ink pill, the one main action), `secondary` (white
 * surface pill), `danger` (red tone), `ghost` (quiet). Sizes: `md` (44px) and
 * `lg` (56px, primary actions on touch layouts).
 *
 * The pre-C2 names (`default`, `outline`, `destructive`, `link`, sizes `xs`,
 * `sm`, `default`, `icon`) still work for the old screens until Phase D
 * removes them. Compact `xs`/`sm` are 32-36px for mouse users and 44px on
 * coarse pointers (ruling R15).
 */
const PRIMARY = "bg-primary text-primary-foreground shadow-button hover:bg-primary/88";
const SECONDARY =
  "border border-border bg-card text-foreground shadow-sm hover:bg-surface-sunken dark:hover:bg-surface-sunken";
const DANGER =
  "bg-[linear-gradient(160deg,var(--tone-red-from),var(--tone-red-to))] text-tone-red-on shadow-button hover:brightness-95";
const GHOST = "text-foreground hover:bg-accent hover:text-accent-foreground";
const MD = "h-11 px-5 text-[15px]";

const buttonVariants = cva(
  // Focus ring comes from the global :focus-visible rule (2px ink, 2px
  // offset). `active:scale` is the C2 `press` motion (off under reduced motion).
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold tracking-[-0.005em] transition-[background-color,color,box-shadow,transform,opacity,filter] duration-[var(--dur-fast)] ease-[var(--ease-out-quart)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        primary: PRIMARY,
        secondary: SECONDARY,
        danger: DANGER,
        ghost: GHOST,
        /** @deprecated use `primary` */
        default: PRIMARY,
        /** @deprecated use `secondary` */
        outline: SECONDARY,
        /** @deprecated use `danger` */
        destructive: DANGER,
        /** @deprecated links are links; use `UiLink` */
        link: "rounded-full px-0 text-foreground underline decoration-1 underline-offset-4 hover:decoration-2",
      },
      size: {
        md: MD,
        lg: "h-14 px-7 text-[17px] font-bold tracking-[-0.01em]",
        /** @deprecated compact office control, 44px on touch */
        xs: "h-8 px-3 text-xs pointer-coarse:h-11 pointer-coarse:px-4",
        /** @deprecated compact office control, 44px on touch */
        sm: "h-9 px-3.5 text-[13px] pointer-coarse:h-11 pointer-coarse:px-4",
        /** @deprecated use `md` */
        default: MD,
        /** @deprecated use `IconButton` */
        icon: "size-11 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    /** Native parity: forwarded to web `onClick` so screens written for RN keep working. */
    onPress?: (e: any) => void;
    children?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, disabled, onPress, onClick, children, type, ...rest },
  ref,
) {
  const Comp = asChild ? Slot : "button";

  // Radix Slot calls React.Children.only, so with asChild the children must
  // stay a single element (no loader sibling, not even a literal null).
  const content = asChild ? (
    children
  ) : (
    <>
      {loading ? <Loader2 className="size-[18px] animate-spin" aria-hidden="true" /> : null}
      {children}
    </>
  );

  return (
    <Comp
      ref={ref as any}
      type={asChild ? undefined : (type ?? "button")}
      data-slot="button"
      data-variant={variant ?? "primary"}
      data-size={size ?? "md"}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      // `disabled` is invalid on anchors etc., so only set it when we own
      // the underlying element.
      disabled={asChild ? undefined : disabled || loading}
      onClick={(e: any) => {
        onPress?.(e);
        onClick?.(e);
      }}
      {...rest}
    >
      {content}
    </Comp>
  );
});

export type IconButtonProps = Omit<ButtonProps, "size" | "children" | "asChild" | "aria-label"> & {
  /** Accessible name, required: an icon alone is never a label. */
  label: string;
  icon: ReactNode;
  size?: "md" | "lg";
};

/** Round icon-only button, 44px (`md`) or 56px (`lg`). Defaults to `ghost`. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", variant = "ghost", className, title, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      aria-label={label}
      title={title ?? label}
      className={cn("p-0", size === "lg" ? "size-14 [&_svg:not([class*='size-'])]:size-6" : "size-11", className)}
      data-size={size}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </Button>
  );
});

export { buttonVariants };
