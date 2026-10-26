import { useT, isGuideSlug } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Link, createFileRoute } from "@tanstack/react-router";

import { GuidePage } from "@/features/guides/guide-page";

export const Route = createFileRoute("/_tenant/guides/$slug")({
  component: GuideRoute,
});

function GuideRoute() {
  const { slug } = Route.useParams();
  const { t } = useT();
  if (!isGuideSlug(slug)) {
    return (
      <>
        <PageHeader title={t("guides.title")} />
        <EmptyState
          title={t("guides.notFoundTitle")}
          body={t("guides.notFoundBody")}
          action={
            <Button asChild>
              <Link to="/guides">{t("guides.all")}</Link>
            </Button>
          }
        />
      </>
    );
  }
  return <GuidePage slug={slug} />;
}
