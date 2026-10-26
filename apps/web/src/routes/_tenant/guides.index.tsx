import { useT } from "@orrn/i18n";
import { listGuides } from "@orrn/i18n/guides";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, ChevronRight } from "lucide-react";

import { useMe } from "@/shared/lib/me";

/**
 * The guide library: every SOP the person's role can follow. Each row opens
 * `/guides/$slug`. Orrn support staff also see the guides written for them.
 */
export const Route = createFileRoute("/_tenant/guides/")({
  component: GuidesIndex,
});

function GuidesIndex() {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const guides = listGuides(locale, me?.company?.role, me?.isPlatformAdmin === true);

  return (
    <>
      <PageHeader title={t("guides.title")} subtitle={t("guides.subtitle")} />
      {guides.length ? (
        <ul
          lang={locale}
          className="m-0 flex list-none flex-col overflow-hidden rounded-card border border-border bg-card p-0"
        >
          {guides.map((g) => (
            <li key={g.slug} className="border-b border-border last:border-b-0">
              <Link
                to="/guides/$slug"
                params={{ slug: g.slug }}
                data-guide-link={g.slug}
                className="flex min-h-16 w-full min-w-0 items-center gap-3 px-4 py-3 text-left text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground"
                >
                  <BookOpen className="size-5" strokeWidth={2} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[16px] font-semibold leading-snug break-words">{g.title}</span>
                  <span className="text-[14px] leading-5 break-words text-muted-foreground">{g.when}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[15px] text-muted-foreground">{t("guides.empty")}</p>
      )}
    </>
  );
}
