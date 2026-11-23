import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Skeleton } from "@orrn/ui/components/skeleton";
import type { ReactNode } from "react";

import { useFmt } from "@/shared/lib/fmt";
import { dayText, kgGrouped1, massUnit, rateText, rupeeScreen } from "@/shared/lib/fmt-text";
import { showsQueryError } from "@/shared/lib/query-errors";

import type { T } from "./model";

/** Formatters over the plant's unit layer, bound once per screen. */
export function useCostSay() {
  const fmt = useFmt();
  const { t } = useT();
  return {
    t: t as T,
    fmt,
    /** Grams as the plant's weight, grouped, no unit word (the header names the unit). */
    kg: (g: number) => kgGrouped1(fmt, g),
    /** Grams with the plant's unit word, for sentences. */
    kgU: (g: number) => `${kgGrouped1(fmt, g)} ${massUnit(fmt)}`,
    /** Paise per kg as the plant's rate, two decimals. */
    rate: (paise: number) => rateText(fmt, paise),
    money: (paise: number) => rupeeScreen(fmt, paise),
    day: (ymd: string) => dayText(fmt, ymd),
  };
}

/** Skeleton while loading, a retry card when the first load failed, else the children. */
export function Loaded<D>({ query, children }: { query: { data: D | undefined; isError: boolean; refetch(): unknown }; children: (data: D) => ReactNode }) {
  const { t } = useT();
  if (showsQueryError(query)) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState title={t("cost.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
      </div>
    );
  }
  if (query.data === undefined) return <Skeleton className="h-40 rounded-card" />;
  return <>{children(query.data)}</>;
}

export function Panel({ title, action, children, testId }: { title: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        {action}
      </CardHeader>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </Card>
  );
}

export function RangeFields({ from, to, onChange }: { from: string; to: string; onChange(next: { from: string; to: string }): void }) {
  const { t } = useT();
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
      <Field label={t("cost.from")}>
        <TextInput type="date" value={from} onChangeText={(v) => onChange({ from: v, to })} />
      </Field>
      <Field label={t("cost.to")}>
        <TextInput type="date" value={to} onChangeText={(v) => onChange({ from, to: v })} />
      </Field>
    </div>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <p className="m-0 text-[14px] text-muted-foreground">{children}</p>;
