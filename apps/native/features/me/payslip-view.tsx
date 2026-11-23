import { rupeesText } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { trpc } from "@/utils/trpc";

import { monthName, slipView, type SlipLine } from "./explain";
import { Section } from "./ui";

function Lines({ lines }: { lines: SlipLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <View key={`${l.name}-${i}`} accessible accessibilityLabel={`${l.name}, ${rupeesText(l.paise)}${l.why ? `, ${l.why}` : ""}`} className="gap-0.5 border-b border-hairline pb-2 last:border-b-0 last:pb-0">
          <View className="flex-row items-baseline justify-between gap-3">
            <Text className="min-w-0 flex-1 font-sans text-base text-ink">{l.name}</Text>
            <Text className="font-mono-medium text-base text-ink">{rupeesText(l.paise)}</Text>
          </View>
          {l.why ? <Text className="font-sans text-sm leading-5 text-ink-muted">{l.why}</Text> : null}
        </View>
      ))}
    </>
  );
}

/** One payslip: every line named, every statutory figure explained, the notes under it. */
export function PayslipView({ id }: { id: string }) {
  const { t } = useT();
  const q = useQuery(trpc.payroll.me.payslips.queryOptions());
  const refetch = () => void q.refetch();
  if (q.isError && !q.data) {
    return (
      <Screen onRefresh={refetch} refreshing={q.isRefetching}>
        <ErrorBlock error={q.error} onRetry={refetch} retrying={q.isRefetching} />
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
  const slip = q.data.find((s) => s.id === id);
  if (!slip) {
    return (
      <Screen>
        <EmptyState title={t("native.hr.payslips.empty")} />
      </Screen>
    );
  }
  const f = slip.figures;
  const v = slipView(t, f);
  return (
    <Screen onRefresh={refetch} refreshing={q.isRefetching}>
      <PageHeader title={t("payroll.payslip.title")} subtitle={t("payroll.payslip.forMonth", { month: monthName(t, f.month) })} />
      <Section title={t("payroll.payslip.earnings")}>
        <Lines lines={v.earnings} />
        <View className="flex-row justify-between gap-3 pt-1">
          <Text className="font-sans-semibold text-base text-ink">{t("payroll.payslip.gross")}</Text>
          <Text className="font-mono-semibold text-base text-ink">{rupeesText(f.grossPaise)}</Text>
        </View>
      </Section>
      <Section title={t("payroll.payslip.deductions")}>
        <Lines lines={v.deductions} />
        <View className="flex-row justify-between gap-3 pt-1">
          <Text className="font-sans-semibold text-base text-ink">{t("payroll.payslip.totalDeductions")}</Text>
          <Text className="font-mono-semibold text-base text-ink">{rupeesText(f.totalDeductionsPaise)}</Text>
        </View>
      </Section>
      <View accessible className="flex-row items-baseline justify-between gap-3 rounded-card bg-surface-sunken px-4 py-4">
        <Text className="font-display-bold text-lg text-ink">{t("payroll.payslip.net")}</Text>
        <Text className="font-mono-semibold text-lg text-ink">{rupeesText(f.netPaise)}</Text>
      </View>
      {v.employer.length > 0 ? (
        <Section title={t("payroll.payslip.employer")}>
          <Lines lines={v.employer} />
        </Section>
      ) : null}
      <View className="gap-1">
        {v.notes.map((n) => (
          <Text key={n} className="font-sans text-sm leading-5 text-ink-muted">
            {n}
          </Text>
        ))}
      </View>
    </Screen>
  );
}
