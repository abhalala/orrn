import { Card } from "@orrn/ui/components/card";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type NavCardProps = {
  title: string;
  description: string;
  to: string;
  icon?: ReactNode;
};

/**
 * Clickable card that links to another route. Replaces the ad-hoc card-with-
 * inner-button pattern from the previous admin dashboard so every action on
 * the console reads the same way.
 */
export function NavCard({ title, description, to, icon }: NavCardProps) {
  return (
    <Link to={to as "/"} className="no-underline group">
      <Card className="h-full transition-all duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
        <div className="flex items-start gap-3">
          {icon ? (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-[var(--dur-fast)] group-hover:bg-primary/15">
              {icon}
            </div>
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <ChevronRight
            size={16}
            className="mt-0.5 text-muted-foreground transition-all duration-[var(--dur-fast)] group-hover:translate-x-0.5 group-hover:text-primary"
          />
        </div>
      </Card>
    </Link>
  );
}
