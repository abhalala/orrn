import { createI18n } from "@orrn/i18n";
import { createFileRoute } from "@tanstack/react-router";

import "@/features/marketing/marketing.css";
import { LegalPage } from "@/features/marketing/legal-page";
import { readStoredLocale } from "@/shared/lib/locale";

export const Route = createFileRoute("/_public/terms")({
  head: () => {
    const { t } = createI18n(readStoredLocale());
    return {
      meta: [{ title: t("legal.terms.metaTitle") }, { name: "description", content: t("legal.terms.intro") }],
    };
  },
  component: TermsPage,
});

function TermsPage() {
  return <LegalPage page="terms" />;
}
