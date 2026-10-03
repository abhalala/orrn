import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { UiLink } from "./link";

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  back?: { to: string; label: string };
  className?: string;
};

/**
 * @deprecated Pre-C2 shape still used by the old screens (eyebrow,
 * description, ReactNode title). Removed in Phase D with its last importer.
 */
export type LegacyPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * Page title block: the page's one `h1` in Bricolage, an optional subtitle
 * line, actions on the right (below the title on phones), and an optional
 * back link above. Keep subtitles to one plain line.
 */
export function PageHeader(props: PageHeaderProps | LegacyPageHeaderProps) {
  const { title, actions, className } = props;
  const subtitle = "subtitle" in props ? props.subtitle : "description" in props ? props.description : undefined;
  const back = "back" in props ? props.back : undefined;
  const eyebrow = "eyebrow" in props ? props.eyebrow : undefined;

  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-3", className)}>
      {back ? (
        <UiLink
          to={back.to}
          className="-ml-3 inline-flex min-h-11 items-center gap-1 self-start rounded-full pr-3 pl-2 text-[15px] font-semibold text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
          {back.label}
        </UiLink>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {eyebrow ? <p className="m-0 text-[13px] font-medium text-muted-foreground">{eyebrow}</p> : null}
          <h1 className="orrn-page-title m-0 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em] text-foreground [overflow-wrap:anywhere] sm:text-[34px]">
            {title}
          </h1>
          {subtitle ? (
            <p className="orrn-page-description m-0 max-w-[680px] text-[15px] leading-6 text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
