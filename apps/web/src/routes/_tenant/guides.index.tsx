import { useT, type GuideSlug } from "@orrn/i18n";
import { listGuides } from "@orrn/i18n/guides";
import { GuideSheet } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useMe } from "@/shared/lib/me";

/**
 * TEMPORARY guides list so the shell's Guides item has somewhere to go. The
 * Guides task replaces it with the full library (`/guides`, `/guides/$slug`).
 * Lists the guides for the person's role; each opens in the guide sheet.
 */
export const Route = createFileRoute("/_tenant/guides/")({
  component: GuidesIndex,
});

function GuidesIndex() {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const [slug, setSlug] = useState<GuideSlug | null>(null);
  const [open, setOpen] = useState(false);
  const guides = listGuides(locale, me?.company?.role);

  return (
    <>
      <PageHeader title={t("guides.title")} subtitle={t("guides.subtitle")} />
      {guides.length ? (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-card border border-border bg-card p-0">
          {guides.map((g) => (
            <li key={g.slug} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  setSlug(g.slug);
                  setOpen(true);
                }}
                className="flex min-h-16 w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-accent"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground"
                >
                  <BookOpen className="size-5" strokeWidth={2} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[16px] font-semibold leading-snug">{g.title}</span>
                  <span className="text-[14px] leading-5 text-muted-foreground">{g.when}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[15px] text-muted-foreground">{t("guides.empty")}</p>
      )}
      {slug ? <GuideSheet slug={slug} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
