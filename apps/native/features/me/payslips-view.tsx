import { useT } from "@orrn/i18n";
import { rupeesText } from "@orrn/domain";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { trpc } from "@/utils/trpc";

import { monthName } from "./explain";
import { isNotLinked } from "./model";
import { Note } from "./ui";

/** More > My work > My payslips: the months the office has locked, newest first. */
export function PayslipsView() {
  const { t } = useT();
  const router = useRouter();
  const q = useQuery(trpc.payroll.me.payslips.queryOptions());
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
  return (
    <Screen onRefresh={refetch} refreshing={q.isRefetching}>
      {q.data.length === 0 ? (
        <EmptyState title={t("native.hr.payslips.empty")} />
      ) : (
        <View className="gap-2">
          {q.data.map((s) => (
            <ListRow key={s.id} title={monthName(t, s.month)} subtitle={t("native.hr.payslips.net", { amount: rupeesText(s.netPaise) })} onPress={() => router.push({ pathname: "/more/me/payslip/[id]", params: { id: s.id } })} />
          ))}
        </View>
      )}
    </Screen>
  );
}
