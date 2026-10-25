import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useRefresh } from "@/features/stock/use-refresh";
import { useDebounced } from "@/features/more/use-debounced";
import { trpc } from "@/utils/trpc";

import { ATTENTION_REASONS, filterAttention, rankAttention, reasonCounts, type AttentionCopy, type ReasonFilter } from "./attention";
import { copyCodeQuery } from "./copy-model";
import { CopyListRow, REASON_KEY } from "./copy-row";
import { useAttentionCopies, type CopyRow } from "./use-attention";

/** Rows drawn at once; "Show more" adds this many. */
const PAGE_ROWS = 40;

function asAttention(row: CopyRow): CopyRow & AttentionCopy {
  // The list may carry `latestReadAt` (ms); until it does, "no reading in 30 days" cannot be told and only "no reading yet" shows.
  const at = (row as { latestReadAt?: number | null }).latestReadAt ?? null;
  return { ...row, status: row.status as AttentionCopy["status"], latestReadAt: at };
}

/**
 * The Dies tab (die room): copies that need attention, worst first (above band, out at nitriding or
 * the maker, on trial, on a press, due a reading), with a search box that finds any copy by code.
 * Scanning a copy label opens its card from the Scan tab.
 */
export function DiesView() {
  const { t } = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const typed = useDebounced(copyCodeQuery(text), 300);
  const [filter, setFilter] = useState<ReasonFilter>("all");
  const [shown, setShown] = useState(PAGE_ROWS);

  const attention = useAttentionCopies();
  const found = useQuery({ ...trpc.dieInstance.list.queryOptions({ search: typed, limit: 50 }), enabled: typed.length > 0 });
  const { refreshing, onRefresh } = useRefresh([attention.refetch, found.refetch]);

  const rows = useMemo(() => rankAttention((attention.data?.items ?? []).map(asAttention), Date.now()), [attention.data]);
  const counts = useMemo(() => reasonCounts(rows), [rows]);
  const visible = useMemo(() => filterAttention(rows, filter), [rows, filter]);

  const open = (id: string) => router.push({ pathname: "/dies/[id]", params: { id } });
  const searching = typed.length > 0;

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Field
        label={t("native.dies.searchLabel")}
        hint={t("dieRoom.board.searchHint")}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setShown(PAGE_ROWS);
        }}
        mono
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      {searching ? (
        found.data === undefined ? (
          found.isError ? (
            <ErrorBlock error={found.error} onRetry={() => void found.refetch()} retrying={found.isFetching} />
          ) : (
            <LoadingBlock />
          )
        ) : found.data.items.length === 0 ? (
          <EmptyState title={t("native.dies.noMatch")} body={t("dieRoom.board.noMatchBody")} />
        ) : (
          <View className="gap-2">
            <Text className="font-sans-medium text-[15px] text-ink">{t("native.dies.found", { count: found.data.total })}</Text>
            {found.data.items.map((copy) => (
              <CopyListRow key={copy.id} copy={copy} onPress={() => open(copy.id)} />
            ))}
          </View>
        )
      ) : attention.data === undefined ? (
        attention.isError ? (
          <ErrorBlock error={attention.error} onRetry={() => void attention.refetch()} retrying={attention.isFetching} />
        ) : (
          <LoadingBlock />
        )
      ) : (
        <>
          <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
            {t("native.dies.attentionCount", { count: rows.length })}
          </Text>

          {rows.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" accessibilityLabel={t("native.dies.filterLabel")}>
              <FilterChip label={`${t("common.all")} ${rows.length}`} selected={filter === "all"} onPress={() => setFilter("all")} />
              {ATTENTION_REASONS.filter((r) => counts[r] > 0).map((r) => (
                <FilterChip key={r} label={`${t(REASON_KEY[r])} ${counts[r]}`} selected={filter === r} onPress={() => setFilter(r)} />
              ))}
            </ScrollView>
          ) : null}

          {attention.data.capped ? <Text className="font-sans text-sm text-ink-muted">{t("native.dies.partial", { count: attention.data.items.length })}</Text> : null}

          {rows.length === 0 ? (
            <EmptyState title={t("native.dies.nothingTitle")} body={t("native.dies.nothingBody")} />
          ) : (
            <View className="gap-2">
              {visible.slice(0, shown).map((row) => (
                <CopyListRow key={row.copy.id} copy={row.copy} reasons={row.reasons} onPress={() => open(row.copy.id)} />
              ))}
              {visible.length > shown ? (
                <Button variant="secondary" label={t("native.dies.showMore", { count: visible.length - shown })} onPress={() => setShown((n) => n + PAGE_ROWS)} />
              ) : null}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      className={cn("min-h-11 justify-center rounded-full border px-4", selected ? "border-primary bg-primary" : "border-control bg-surface")}
    >
      <Text numberOfLines={1} className={cn("font-sans-semibold text-[14px]", selected ? "text-primary-foreground" : "text-ink")}>
        {label}
      </Text>
    </PressableScale>
  );
}
