import { useT } from "@orrn/i18n";
import { useRouter } from "expo-router";
import { Text } from "react-native";

import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ListRow } from "@/components/ui/list-row";
import { guidesFor } from "@/features/guides/guides";
import { useMe } from "@/utils/me";

/** Step by step help for each job, in the current language, for the jobs this role does. */
export default function GuidesScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const { data: me } = useMe();
  const guides = guidesFor(locale, me?.company?.role);

  return (
    <Screen>
      <PageHeader title={t("guides.title")} subtitle={t("guides.subtitle")} />
      {guides.length > 0 ? (
        guides.map((g) => (
          <ListRow
            key={g.slug}
            title={g.title}
            subtitle={g.when}
            onPress={() => router.push({ pathname: "/more/guides/[slug]", params: { slug: g.slug } })}
          />
        ))
      ) : (
        <Text className="font-sans text-[15px] text-ink-muted">{t("guides.empty")}</Text>
      )}
    </Screen>
  );
}
