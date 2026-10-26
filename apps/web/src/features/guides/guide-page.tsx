import { useT, type GuideSlug, type MessageKey } from "@orrn/i18n";
import { getGuide } from "@orrn/i18n/guides";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { useMe } from "@/shared/lib/me";

import { relatedScreensFor } from "./related";

/**
 * One guide as a page: who it is for, numbered step cards, the usual mistakes
 * and links to the screens it talks about. The words come from
 * `@orrn/i18n/guides`, so the language toggle switches them instantly.
 */
export function GuidePage({ slug }: { slug: GuideSlug }) {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const guide = getGuide(slug, locale);
  const related = relatedScreensFor(slug, me);
  const roles = guide.roles
    .map((r) => (r === "platform_admin" ? t("guides.platformRole") : t(`roles.${r}` as MessageKey)))
    .join(", ");

  return (
    <article lang={locale} data-guide-slug={slug} className="flex flex-col gap-6">
      <PageHeader back={{ to: "/guides", label: t("guides.all") }} title={guide.title} subtitle={guide.when} />
      <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("guides.forRoles", { roles })}</p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <section aria-labelledby="guide-steps" className="flex min-w-0 flex-col gap-3">
          <h2 id="guide-steps" className="m-0 text-[18px] font-bold leading-tight">
            {t("guides.steps")}
          </h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {guide.steps.map((step, i) => (
              <li
                key={step.title}
                data-slot="guide-step"
                className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 rounded-card border border-border bg-card p-4"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 items-center justify-center rounded-full bg-primary text-[16px] font-semibold text-primary-foreground tabular-nums"
                >
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="m-0 text-[16px] font-semibold leading-snug break-words">
                    <span className="sr-only">{t("guides.step", { n: i + 1 })}: </span>
                    {step.title}
                  </h3>
                  <p className="m-0 text-[15px] leading-6 break-words text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex min-w-0 flex-col gap-8">
          {guide.problems.length ? (
            <section aria-labelledby="guide-problems" className="flex flex-col gap-3">
              <h2 id="guide-problems" className="m-0 text-[18px] font-bold leading-tight">
                {t("guides.problems")}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {guide.problems.map((p) => (
                  <li key={p.title} className="rounded-card bg-surface-sunken px-4 py-3">
                    <p className="m-0 text-[15px] font-semibold leading-snug break-words">{p.title}</p>
                    <p className="m-0 mt-1 text-[14px] leading-6 break-words text-muted-foreground">{p.fix}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {related.length ? (
            <section aria-labelledby="guide-related" className="flex flex-col gap-3">
              <h2 id="guide-related" className="m-0 text-[18px] font-bold leading-tight">
                {t("guides.related")}
              </h2>
              <ul className="m-0 flex list-none flex-col overflow-hidden rounded-card border border-border bg-card p-0">
                {related.map((screen) => (
                  <li key={screen.to} className="border-b border-border last:border-b-0">
                    <Link
                      to={screen.to as never}
                      className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 text-[15px] font-semibold text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent"
                    >
                      <span className="min-w-0 break-words">{t(screen.labelKey)}</span>
                      <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}
