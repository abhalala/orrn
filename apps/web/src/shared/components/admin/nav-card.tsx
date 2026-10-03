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
    <Link to={to as "/"} className="group rounded-card no-underline">
      <Card className="h-full transition-[border-color,box-shadow,transform] duration-[var(--dur-fast)] hover:border-control/60 hover:shadow-md group-active:scale-[0.99]">
        <div className="flex items-start gap-3">
          {icon ? (
            <div aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md bg-tone-violet-tint text-tone-violet-ink">
              {icon}
            </div>
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="m-0 text-[15px] font-semibold text-foreground">{title}</p>
            <p className="m-0 mt-1 text-[13px] text-muted-foreground">{description}</p>
          </div>
          <ChevronRight
            size={16}
            className="mt-0.5 text-muted-foreground transition-all duration-[var(--dur-fast)] group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true"
          />
        </div>
      </Card>
    </Link>
  );
}
