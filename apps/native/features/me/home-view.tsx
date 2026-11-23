import { useT, type MessageKey } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import { monthName } from "./explain";
import { attendanceFigures, daysText, isNotLinked } from "./model";
import { showsMyPayslips } from "@/features/more/more-rows";
import { Figure, Note, Section } from "./ui";

/** More > My work: this month's attendance, leave balances, and the doors to leave and payslips. Everything is the server's. */
export function HomeView() {
  const { t } = useT();
  const router = useRouter();
  const { data: me } = useMe();
  const q = useQuery(trpc.hr.me.summary.queryOptions());
  const refetch = () => void q.refetch();

  if (q.isError && !q.data) {
    return (
      <Screen onRefresh={refetch} refreshing={q.isRefetching}>
        {isNotLinked(q.error) ? <Note>{t("native.hr.notLinked")}</Note> : <ErrorBlock error={q.error} onRetry={refetch} retrying={q.isRefetching} />}
      </Screen>
    );
  }
  if (!q.data) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }
  const s = q.data;
  return (
    <Screen onRefresh={refetch} refreshing={q.isRefetching}>
      <Section title={`${t("native.hr.attendance")} (${monthName(t, s.month)})`}>
        <View className="flex-row flex-wrap gap-x-4 gap-y-3">
          {attendanceFigures(s.totals).map((f) => (
            <Figure key={f.key} label={t(`native.hr.${f.key}` as MessageKey)} value={f.value} />
          ))}
          {s.totals.overtimeMin > 0 ? <Figure label={t("native.hr.overtime")} value={t("payroll.payslip.explain.time", { hours: Math.floor(s.totals.overtimeMin / 60), minutes: s.totals.overtimeMin % 60 })} /> : null}
        </View>
      </Section>

      <Section title={t("native.hr.balances")}>
        {s.balances.length === 0 ? (
          <Text className="font-sans text-[15px] text-ink-muted">{t("native.hr.balancesEmpty")}</Text>
        ) : (
          s.balances.map((b) => (
            <View key={b.kindId} accessible className="gap-0.5 border-b border-hairline pb-3 last:border-b-0 last:pb-0">
              <Text className="font-sans-semibold text-base text-ink">{b.name}</Text>
              <Text className="font-sans text-[15px] text-ink">{t("native.hr.balanceLine", { left: daysText(b.balanceHalves), quota: daysText(b.quotaHalves + b.carryInHalves) })}</Text>
              {b.pendingHalves > 0 ? <Text className="font-sans text-sm text-ink-muted">{t("native.hr.balanceWaiting", { count: daysText(b.pendingHalves) })}</Text> : null}
            </View>
          ))
        )}
      </Section>

      <View className="gap-2">
        <ListRow title={t("native.hr.openLeave")} subtitle={t("native.hr.openLeaveHint")} onPress={() => router.push("/more/me/leave")} />
        {showsMyPayslips(me) ? <ListRow title={t("native.hr.openPayslips")} subtitle={t("native.hr.openPayslipsHint")} onPress={() => router.push("/more/me/payslips")} /> : null}
      </View>
    </Screen>
  );
}

/** A screen the person may not open (a deep link, a module switched off): one plain sentence. */
export function NotForYou() {
  const { t } = useT();
  return (
    <Screen>
      <EmptyState title={t("native.hr.notLinked")} />
    </Screen>
  );
}
