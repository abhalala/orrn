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
      <Card className="hover:border-primary/50 transition-colors duration-150">
        <div className="flex items-start gap-3">
          {icon ? (
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {icon}
            </div>
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <ChevronRight
            size={16}
            className="text-muted-foreground group-hover:text-foreground transition-colors mt-0.5"
          />
        </div>
      </Card>
    </Link>
  );
}
