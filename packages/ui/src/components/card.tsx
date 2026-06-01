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
        "flex flex-col gap-3 rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        size === "sm" ? "p-3 gap-2" : "p-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h4
      data-slot="card-title"
      className={cn("text-base font-semibold leading-tight m-0", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-xs text-muted-foreground m-0", className)}
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
      className={cn("flex items-center gap-2 border-t border-border pt-3", className)}
      {...props}
    />
  );
}

export type CardSectionProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export function CardSection({ title, description, actions, className, children, ...rest }: CardSectionProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)} {...rest}>
      {(title || actions) && (
        <div className="flex items-center gap-3">
          <div className="flex flex-1 flex-col gap-0.5">
            {title ? <h4 className="m-0 text-sm font-semibold">{title}</h4> : null}
            {description ? <p className="m-0 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
