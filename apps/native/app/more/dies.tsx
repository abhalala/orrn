import { useT } from "@orrn/i18n";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { dieCode, kgText } from "@/features/dies/die-display";
import { PagedList } from "@/features/more/paged-list";
import { useDebounced } from "@/features/more/use-debounced";
import { trpc } from "@/utils/trpc";

const PAGE = 50;

/** Dies: search by code, series, section or name; tap one for its weight band and measurements. */
export default function DiesScreen() {
  const { t } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const [refreshing, setRefreshing] = useState(false);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void queryClient.invalidateQueries(trpc.die.list.pathFilter()).finally(() => setRefreshing(false));
      }}
    >
      <Field
        label={t("dies.searchLabel")}
        placeholder={t("dies.search")}
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <PagedList
        key={q}
        pageSize={PAGE}
        usePage={(offset) =>
          useQuery({
            ...trpc.die.list.queryOptions({ search: q || undefined, limit: PAGE, offset }),
            placeholderData: keepPreviousData,
          })
        }
        empty={
          q ? (
            <EmptyState title={t("common.noResults", { query: q })} />
          ) : (
            <EmptyState title={t("dies.empty")} />
          )
        }
        renderRow={(d) => {
          const range = t("dies.rangeValue", { min: kgText(d.weightMinG), max: kgText(d.weightMaxG) });
          const code = dieCode(d);
          const name = d.name ?? t("dies.unnamed");
          return (
            <ListRow
              key={d.id}
              title={code}
              subtitle={name}
              accessibilityLabel={`${code}, ${name}, ${range} ${t("units.kgPer12ft")}`}
              onPress={() => router.push({ pathname: "/more/dies/[id]", params: { id: d.id } })}
              trailing={
                <>
                  {d.status === "archived" ? <Chip tone="neutral" label={t("status.die.archived")} /> : null}
                  <Text className="font-mono-medium text-sm text-ink">
                    {range}
                  </Text>
                </>
              }
            />
          );
        }}
      />
    </Screen>
  );
}
