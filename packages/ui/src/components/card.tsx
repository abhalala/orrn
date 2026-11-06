import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  size?: "sm" | "default";
};

export function Card({ size = "default", className, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-3 rounded-card border border-border bg-card text-card-foreground shadow-sm",
        size === "sm" ? "p-3 gap-2" : "p-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1", className)} {...props} />;
}

/** A card's heading level. Default h2: a card sits under the page's h1, and h4 straight after h1 skips two levels. */
type CardHeadingLevel = "h2" | "h3" | "h4";

export function CardTitle({ className, as: Heading = "h2", ...props }: HTMLAttributes<HTMLHeadingElement> & { as?: CardHeadingLevel }) {
  return (
    <Heading
      data-slot="card-title"
      className={cn("m-0 text-base font-semibold leading-snug tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="card-description"
      className={cn("m-0 text-[13px] leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardAction({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-action"
      className={cn("ml-auto flex items-center gap-2", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={cn("flex flex-col gap-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-2 border-t border-border pt-4", className)}
      {...props}
    />
  );
}

export type CardSectionProps = HTMLAttributes<HTMLDivElement> & {
  /** Heading level of the title; default h2 (see CardTitle). */
  titleAs?: CardHeadingLevel;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export function CardSection({ title, titleAs: Heading = "h2", description, actions, className, children, ...rest }: CardSectionProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)} {...rest}>
      {(title || actions) && (
        <div className="flex items-center gap-3">
          <div className="flex flex-1 flex-col gap-0.5">
            {title ? <Heading className="m-0 text-[15px] font-semibold tracking-[-0.01em]">{title}</Heading> : null}
            {description ? <p className="m-0 text-[13px] text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
