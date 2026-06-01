import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

/**
 * ORRN Button. Web (shadcn) implementation: Radix Slot + Tailwind classes.
 * The native variant (`button.native.tsx`) preserves the same prop surface.
 *
 * `buttonVariants` is exported as a real CVA so anchor-style usages from
 * pre-migration code still work; callers should prefer wrapping with
 * `<Button asChild><a /></Button>` going forward.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "border border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline px-0",
      },
      size: {
        xs: "h-7 px-2 text-xs",
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4 text-sm",
        lg: "h-11 px-6 text-sm",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    /** Native parity — forwarded to web `onClick` so screens written for RN keep working. */
    onPress?: (e: any) => void;
    children?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, disabled, onPress, onClick, children, type, ...rest },
  ref,
) {
  const Comp = asChild ? Slot : "button";

  // When asChild is true we delegate to Radix Slot, which calls
  // React.Children.only on its children. Rendering `{loading ? <Loader/> : null}{children}`
  // unconditionally would give Slot two siblings (even when `loading` is false
  // the literal `null` counts) and crash with "expected to receive a single
  // React element child". Build the children once, conditionally, so Slot
  // sees a single element.
  const content = asChild ? (
    children
  ) : (
    <>
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </>
  );

  return (
    <Comp
      ref={ref as any}
      type={asChild ? undefined : (type ?? "button")}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      // `disabled` is invalid on anchors etc., so only set it when we own
      // the underlying element.
      disabled={asChild ? undefined : (disabled || loading)}
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

export { buttonVariants };
