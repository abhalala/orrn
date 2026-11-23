import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { canAny, useMe, type Action } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { useQaModuleOn, type QaLineAlloy, type QaRunView, type QaToday } from "./hooks";

/** Who sees quality flags on other screens: anyone who checks, holds, releases or keeps the lists. */
export const QA_FLAG_PEOPLE: readonly Action[] = ["qa.check", "qa.hold", "qa.release", "qa.masters"];

/** Quality flags show only with the module on and a quality role; otherwise nothing renders and nothing is asked. */
export function useQaFlagsOn(): boolean {
  const { data: me } = useMe();
  const moduleOn = useQaModuleOn();
  return moduleOn && canAny(me, QA_FLAG_PEOPLE);
}

/** True when a run's quality has something to say on the press station. */
export function runNeedsFlag(d: Pick<QaRunView, "firstPieceBlocksPack" | "firstPieceState" | "inProcessDue" | "breaches">): boolean {
  return (d.firstPieceBlocksPack && d.firstPieceState !== "passed") || d.firstPieceState === "failed" || d.inProcessDue.due || d.breaches.length > 0;
}

/** The press station's quality line (rows 24, 28, 39): first piece missing or failed, a check due, plan breaches. */
export function RunQualityFlag({ runId }: { runId: string }) {
  const on = useQaFlagsOn();
  const q = useQuery({ ...trpc.qa.run.queryOptions({ runId }), enabled: on, retry: false });
  if (!on || !q.data || !runNeedsFlag(q.data)) return null;
  return <RunQualityFlagBody data={q.data} />;
}

export function RunQualityFlagBody({ data }: { data: QaRunView }) {
  const { t } = useT();
  return (
    <section aria-label={t("qa.title")} data-testid="qa-run-flag" className="flex min-w-0 flex-col gap-1.5 rounded-card border border-border bg-tone-amber-tint px-4 py-3 text-[15px] text-tone-amber-ink">
      {data.firstPieceState === "failed" ? <p className="m-0 font-semibold">{t("qa.refusal.firstPieceFailed", { run: data.run.number })}</p> : null}
      {data.firstPieceState === "waiting" && data.firstPieceBlocksPack ? <p className="m-0 font-semibold">{t("qa.run.blocksPack")}</p> : null}
      {data.inProcessDue.due ? <p className="m-0">{t("qa.run.due", { count: data.inProcessDue.bundlesSince })}</p> : null}
      {data.breaches.length > 0 ? <p className="m-0">{t("qa.run.breaches")}</p> : null}
      <UiLink to={`/qa?tab=checks&run=${encodeURIComponent(data.run.id)}`} className="font-semibold underline underline-offset-4">
        {t("qa.today.open")}
      </UiLink>
    </section>
  );
}

/** Today (row 38): bundles on quality hold, instruments overdue and due soon. Nothing when all is clear. */
export function TodayQaTile() {
  const on = useQaFlagsOn();
  const q = useQuery({ ...trpc.qa.today.queryOptions(), enabled: on, retry: false });
  if (!on || !q.data || !q.data.moduleOn) return null;
  if (q.data.onHold === 0 && q.data.overdue.length === 0 && q.data.dueSoon === 0) return null;
  return <TodayQaTileBody data={q.data} />;
}

export function TodayQaTileBody({ data }: { data: QaToday }) {
  const { t } = useT();
  return (
    <section aria-labelledby="today-qa" data-testid="today-qa" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-qa" className="m-0 text-[17px] font-semibold">
          {t("qa.today.title")}
        </h2>
        <UiLink to="/qa" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
          {t("qa.today.open")}
        </UiLink>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusBlock tone={data.onHold > 0 ? "amber" : "neutral"} title={t("qa.tabs.holds")} meta={t("qa.today.onHold", { count: data.onHold })} value={data.onHold} countUp={false} href="/qa?tab=holds" />
        <StatusBlock
          tone={data.overdue.length > 0 ? "red" : "neutral"}
          title={t("qa.instruments.states.overdue")}
          meta={data.overdue.length > 0 ? data.overdue.map((i) => i.code).join(", ") : t("qa.today.overdue", { count: 0 })}
          value={data.overdue.length}
          countUp={false}
          href="/qa?tab=instruments"
        />
        <StatusBlock tone={data.dueSoon > 0 ? "amber" : "neutral"} title={t("qa.instruments.states.due_soon")} meta={t("qa.today.dueSoon", { count: data.dueSoon })} value={data.dueSoon} countUp={false} href="/qa?tab=instruments" />
      </div>
    </section>
  );
}

/** An order line whose alloy is short (row 37): billets on hand, the kg left, and the substitutes allowed. */
export function OrderLineAlloy({ lineId }: { lineId: string }) {
  const on = useQaFlagsOn();
  const q = useQuery({ ...trpc.qa.substitutes.forLine.queryOptions({ lineId }), enabled: on, retry: false });
  if (!on || !q.data || !q.data.short || !q.data.alloy) return null;
  return <OrderLineAlloyBody data={q.data} />;
}

export function OrderLineAlloyBody({ data }: { data: QaLineAlloy }) {
  const { t } = useT();
  const fmt = useFmt();
  const unit = massUnit(fmt);
  const alloy = data.alloy ?? "";
  return (
    <div data-testid="qa-alloy-short" className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-tone-amber-tint px-4 py-3 text-[14px] text-tone-amber-ink">
      <p className="m-0 font-semibold">{t("qa.substitutes.short")}</p>
      <p className="m-0">{t("qa.substitutes.shortBody", { alloy, have: kgGrouped3(fmt, data.onHandG), need: kgGrouped3(fmt, data.needG), massUnit: unit })}</p>
      {data.substitutes.length === 0 ? (
        <p className="m-0">{t("qa.substitutes.noneAllowed", { alloy })}</p>
      ) : (
        <p className="m-0" data-testid="qa-alloy-substitutes">
          {t("qa.substitutes.allowed")}:{" "}
          {data.substitutes.map((s) => `${s.alloy} (${t("qa.substitutes.onHand", { kg: kgGrouped3(fmt, s.onHandG), massUnit: unit })})`).join(", ")}
        </p>
      )}
    </div>
  );
}

/** Temper codes from the plant's temper master, for the order line's temper box (row 35). Empty with the module off. */
export function useTemperCodes(): string[] {
  const moduleOn = useQaModuleOn();
  const q = useQuery({ ...trpc.qa.tempers.list.queryOptions(), enabled: moduleOn, retry: false, staleTime: 5 * 60_000 });
  if (!moduleOn || !q.data) return [];
  return [...new Set(q.data.items.map((x) => x.code))];
}
