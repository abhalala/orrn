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
  // Pill, ink-first. Focus ring comes from the global :focus-visible rule
  // (2px ink, 2px offset). `active:scale` is the C2 `press` motion.
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold tracking-[-0.005em] transition-[background-color,color,box-shadow,transform,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out-quart)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** Primary: ink pill (black on light, off-white on dark). */
        default:
          "bg-primary text-primary-foreground shadow-button hover:bg-primary/88",
        /** Secondary: surface pill with a hairline. */
        outline:
          "border border-border bg-card text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        /** Destructive: the red tone block. */
        destructive:
          "bg-[linear-gradient(160deg,var(--tone-red-from),var(--tone-red-to))] text-tone-red-on shadow-button hover:brightness-95",
        link: "rounded-sm px-0 text-foreground underline decoration-1 underline-offset-4 hover:decoration-2",
      },
      size: {
        // Touch targets: >= 44px on coarse pointers for every size; the
        // compact sizes only shrink for mouse/trackpad users.
        xs: "h-8 px-3 text-xs pointer-coarse:h-11 pointer-coarse:px-4",
        sm: "h-9 px-3.5 text-[13px] pointer-coarse:h-11 pointer-coarse:px-4",
        default: "h-11 px-5 text-sm",
        lg: "h-14 px-7 text-base",
        icon: "size-11 p-0",
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
