import { createI18n } from "@orrn/i18n";
import { createFileRoute } from "@tanstack/react-router";

import "@/features/marketing/marketing.css";
import { LegalPage } from "@/features/marketing/legal-page";
import { readStoredLocale } from "@/shared/lib/locale";

export const Route = createFileRoute("/_public/privacy")({
  head: () => {
    const { t } = createI18n(readStoredLocale());
    return {
      meta: [{ title: t("legal.privacy.metaTitle") }, { name: "description", content: t("legal.privacy.intro") }],
    };
  },
  component: PrivacyPage,
});

function PrivacyPage() {
  return <LegalPage page="privacy" />;
}
