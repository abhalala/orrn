/**
 * `/orders/plan`: the press plan board (desktop and 11" only). Open lines come from
 * `plans.candidates` grouped by die; the planner picks lines into a draft of dies in run order,
 * sets the 24-hour window, and `plans.create` saves a draft. Releasing it is on the plan's page.
 * Kg per line is what the server says is still planable; nothing is worked out here.
 */
import { formatLength as formatLengthMm } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Input } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { orderErrorLines } from "./errors";
import { dayText, dayTimeText, orderKgText } from "./format";
import { useCompanyTimeZone, useMinWidth } from "./hooks";
import {
  addPlanLine,
  addPlanLines,
  dieTitle,
  draftCounts,
  draftGroups,
  draftOrderCount,
  PLAN_VIEWS,
  fromZonedInput,
  movePlanDie,
  removePlanLine,
  soLines,
  toggleUrgent,
  toZonedInput,
  windowState,
  windowWords,
  type DraftDie,
  type PlanView,
} from "./view";
import { OtherLines } from "./components/other-lines";
import { parseKgG } from "./line-model";

type DraftLineInfo = {
  lineId: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string | null;
  series: string;
  customerName: string;
  poNumber: string | null;
  orderNumber: string;
  cutLengthMm: number;
  planableG: number;
};

export const PLAN_STATUS_TONE = { draft: "amber", released: "green", closed: "neutral", cancelled: "red" } as const;

export function PlanBoardPage() {
  const { t } = useT();
  const wide = useMinWidth(820);
  return (
    <>
      <PageHeader title={t("press.plan.title")} subtitle={t("orders.plan.subtitle")} back={{ to: "/orders", label: t("orders.title") }} />
      {wide ? (
        <div className="flex min-w-0 flex-col gap-6">
          <PlanList />
          <Can do="order.plan">
            <PlanBuilder />
          </Can>
        </div>
      ) : (
        <BiggerScreenNote />
      )}
    </>
  );
}

export function BiggerScreenNote() {
  const { t } = useT();
  return (
    <div role="status" data-bigger-screen="" className="rounded-card border border-border bg-card">
      <EmptyState title={t("orders.plan.biggerTitle")} body={t("orders.plan.biggerBody")} />
    </div>
  );
}

const PLAN_PAGE = 20;

function PlanList() {
  const { t } = useT();
  // Review m-3: page through every plan (20 at a time), never stop silently at the first page.
  const [pages, setPages] = useState<number[]>([0]);
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={t("orders.plan.recent")}>
      <h2 className="m-0 text-[15px] font-semibold">{t("orders.plan.recent")}</h2>
      {pages.map((offset, i) => (
        <PlanListPage
          key={offset}
          offset={offset}
          first={i === 0}
          onMore={i === pages.length - 1 ? (next) => setPages((cur) => [...cur, next]) : undefined}
        />
      ))}
    </section>
  );
}

function PlanListPage({ offset, first, onMore }: { offset: number; first: boolean; onMore?: (next: number) => void }) {
  const { t, locale } = useT();
  const zone = useCompanyTimeZone();
  const plans = useQuery(trpc.plans.list.queryOptions({ limit: PLAN_PAGE, offset }));
  return (
    <>
      {plans.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : plans.isError ? (
        <p role="alert" className="m-0 text-[14px] text-destructive">
          {t("errors.generic")}
        </p>
      ) : plans.data.items.length === 0 ? (
        first ? <p className="m-0 text-[14px] text-muted-foreground">{t("orders.plan.noPlans")}</p> : null
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
          {plans.data.items.map((p) => (
            <li key={p.id}>
              <Link
                to="/orders/plan/$id"
                params={{ id: p.id }}
                data-plan={p.number}
                className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card px-4 py-3 no-underline hover:border-foreground/70"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[15px] font-semibold tabular-nums">{p.number}</span>
                  <Chip tone={PLAN_STATUS_TONE[p.status]} truncate={false}>
                    {t(`press.plan.status.${p.status}`)}
                  </Chip>
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {t("press.plan.window", { from: dayTimeText(p.windowStart, locale, zone), to: dayTimeText(p.windowEnd, locale, zone) })}
                </span>
                <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                  {t("orders.plan.summary", { dies: p.dies, kg: orderKgText(p.kgG) })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {onMore && plans.data?.nextOffset != null ? (
        <Button variant="ghost" className="self-start" onClick={() => onMore(plans.data!.nextOffset!)}>
          {t("common.showMore")}
        </Button>
      ) : null}
    </>
  );
}

function PlanBuilder() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { unit } = useLengthUnit();
  const candidates = useQuery(trpc.plans.candidates.queryOptions({ limit: 300 }));

  // BACKLOG 51: the window starts as the current production day on the plant's clock, from the
  // server (never the browser's clock or zone); the fields are the plant's wall clock too.
  const zone = useCompanyTimeZone();
  const defaultWin = useQuery(trpc.plans.defaultWindow.queryOptions());
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [windowTouched, setWindowTouched] = useState(false);
  useEffect(() => {
    if (!defaultWin.data || windowTouched) return;
    setStartText(toZonedInput(defaultWin.data.startMs, defaultWin.data.timezone));
    setEndText(toZonedInput(defaultWin.data.endMs, defaultWin.data.timezone));
  }, [defaultWin.data, windowTouched]);
  const planZone = defaultWin.data?.timezone ?? zone;
  const [draft, setDraft] = useState<DraftDie[]>([]);
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("all");
  const [errors, setErrors] = useState<string[]>([]);
  const [view, setView] = useState<PlanView>("die");
  // Review m-4: kg per draft line (blank = all that is left to plan) and the press when there are two.
  const [lineKg, setLineKg] = useState<Record<string, string>>({});
  const [pressLineId, setPressLineId] = useState("");
  const pressLines = useQuery(trpc.plans.pressLines.queryOptions());

  const startMs = fromZonedInput(startText, planZone);
  const endMs = fromZonedInput(endText, planZone);
  const win = startMs == null || endMs == null ? "order" : windowState(startMs, endMs);

  const dies = candidates.data?.dies ?? [];
  const draftSections = useMemo(() => draft.map((d) => d.sectionId), [draft]);
  const draftLineIds = useMemo(() => draft.flatMap((d) => d.lineIds), [draft]);
  // FP-OP-15 / rank 30 while drafting: every other open line on the draft's dies, from the server.
  const others = useQuery({
    ...trpc.plans.openLinesForDies.queryOptions({ dieIds: draftSections, excludeLineIds: draftLineIds }),
    enabled: draftSections.length > 0,
    placeholderData: (prev) => prev,
  });
  const lineById = useMemo(() => {
    const m = new Map<string, DraftLineInfo>();
    for (const o of others.data?.lines ?? []) {
      m.set(o.lineId, {
        lineId: o.lineId,
        sectionId: o.sectionId,
        sectionCode: o.sectionCode,
        sectionName: null,
        series: "",
        customerName: o.customerName,
        poNumber: o.poNumber,
        orderNumber: o.orderNumber,
        cutLengthMm: o.cutLengthMm,
        planableG: o.planableG,
      });
    }
    for (const d of dies) {
      for (const l of d.lines) {
        m.set(l.lineId, {
          lineId: l.lineId,
          sectionId: d.sectionId,
          sectionCode: d.sectionCode,
          sectionName: l.sectionName,
          series: l.series,
          customerName: l.customerName,
          poNumber: l.poNumber,
          orderNumber: l.orderNumber,
          cutLengthMm: l.cutLengthMm,
          planableG: l.strip.planableG,
        });
      }
    }
    return m;
  }, [dies, others.data]);
  // Lines added from the other-lines list stay known after that list stops naming them.
  const [kept, setKept] = useState<Map<string, DraftLineInfo>>(new Map());
  const infoOf = (lineId: string) => lineById.get(lineId) ?? kept.get(lineId);
  const sectionById = useMemo(() => new Map(dies.map((d) => [d.sectionId, d])), [dies]);
  const customers = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dies) for (const l of d.lines) m.set(l.customerId, l.customerName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [dies]);

  const onDraft = useMemo(() => new Set(draft.flatMap((d) => d.lineIds)), [draft]);
  const q = query.trim().toLowerCase();
  const open = dies
    .map((d) => ({
      ...d,
      lines: d.lines.filter((l) => {
        if (onDraft.has(l.lineId)) return false;
        if (customerId !== "all" && l.customerId !== customerId) return false;
        if (!q) return true;
        return [l.orderNumber, l.customerName, l.poNumber ?? "", d.sectionCode, l.sectionName ?? "", l.series].some((s) => s.toLowerCase().includes(q));
      }),
    }))
    .filter((d) => d.lines.length > 0);
  const soCount = new Map<string, number>();
  for (const d of open) for (const l of d.lines) soCount.set(l.orderId, (soCount.get(l.orderId) ?? 0) + 1);

  const counts = draftCounts(draft);
  const badKg = draftLineIds.filter((id) => (lineKg[id] ?? "").trim() !== "" && parseKgG(lineKg[id]!) == null);
  const twoPresses = (pressLines.data?.length ?? 0) > 1;

  const create = useMutation({
    mutationFn: () =>
      trpcClient.plans.create.mutate({
        windowStart: startMs!,
        windowEnd: endMs!,
        ...(pressLineId ? { pressLineId } : {}),
        dies: draft.map((d) => ({
          sectionId: d.sectionId,
          urgent: d.urgent,
          lines: d.lineIds.map((salesOrderLineId) => {
            const kgG = parseKgG(lineKg[salesOrderLineId] ?? "");
            return kgG != null ? { salesOrderLineId, kgG } : { salesOrderLineId };
          }),
        })),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: trpc.plans.list.queryKey() });
      await queryClient.invalidateQueries({ queryKey: trpc.plans.candidates.queryKey() });
      void navigate({ to: "/orders/plan/$id", params: { id: res.id } });
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  const label = (mm: number) => formatLengthMm(mm, unit);
  const orderOf = (lineId: string) => infoOf(lineId)?.orderNumber;
  const orderIdOf = (lineId: string) => dies.flatMap((d) => d.lines).find((l) => l.lineId === lineId)?.orderId ?? others.data?.lines.find((l) => l.lineId === lineId)?.orderId;
  const groups = draftGroups(draft, view, orderOf);
  const orderCount = draftOrderCount(draft, orderOf);
  /** One line of the draft, with the kg box; `showDie` names its die when the die is not the heading. */
  const draftLine = (sectionId: string, lineId: string, showDie: boolean) => {
    const l = infoOf(lineId);
    if (!l) return null;
    const kgText = lineKg[lineId] ?? "";
    const bad = badKg.includes(lineId);
    return (
      <li key={lineId} data-draft-line={l.orderNumber} className="flex min-w-0 flex-wrap items-end justify-between gap-2 border-t border-border pt-2">
        <div className="min-w-0 flex-1">
          {showDie ? (
            <p className="m-0 font-mono text-[14px] font-semibold tabular-nums">{dieTitle({ sectionCode: l.sectionCode, sectionName: l.sectionName, series: l.series })}</p>
          ) : null}
          <p className="m-0 text-[14px] leading-5 break-words">
            {l.customerName}
            {l.poNumber ? ` · ${l.poNumber}` : ""}
          </p>
          <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
            {l.orderNumber} · {label(l.cutLengthMm)} · {t("orders.plan.planable", { kg: orderKgText(l.planableG) })}
          </p>
        </div>
        <div className="w-[9rem]">
          <Field label={t("orders.plan.lineKg", { order: l.orderNumber })} error={bad ? t("orders.form.errors.qty") : undefined}>
            <NumberInput
              value={kgText}
              onValueChange={(v) => setLineKg((cur) => ({ ...cur, [lineId]: v }))}
              suffix={t("units.kg")}
              placeholder={orderKgText(l.planableG)}
              aria-label={t("orders.plan.lineKg", { order: l.orderNumber })}
            />
          </Field>
        </div>
        <Button variant="ghost" onClick={() => setDraft((cur) => removePlanLine(cur, sectionId, lineId))}>
          {t("common.remove")}
        </Button>
      </li>
    );
  };
  const canCreate = draft.length > 0 && win === "ok" && badKg.length === 0 && (!twoPresses || pressLineId !== "") && !create.isPending;

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={t("press.plan.new")}>
      <h2 className="m-0 text-[15px] font-semibold">{t("press.plan.new")}</h2>
      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t("orders.plan.from")}>
            <TextInput
              type="datetime-local"
              value={startText}
              onChangeText={(v) => {
                setWindowTouched(true);
                setStartText(v);
                const ms = fromZonedInput(v, planZone);
                if (ms != null) setEndText(toZonedInput(ms + 24 * 3_600_000, planZone));
              }}
            />
          </Field>
          <Field
            label={t("orders.plan.to")}
            error={win === "long" ? t("orders.plan.windowLong") : win === "order" && endText ? t("orders.plan.windowOrder") : undefined}
            hint={t("orders.plan.windowHint")}
          >
            <TextInput
              type="datetime-local"
              value={endText}
              onChangeText={(v) => {
                setWindowTouched(true);
                setEndText(v);
              }}
            />
          </Field>
          {defaultWin.data && startMs != null && endMs != null && win === "ok" ? (
            <p data-plan-window="" className="m-0 text-[14px] leading-6 text-muted-foreground md:col-span-2">
              {(() => {
                const w = windowWords(startMs, endMs, planZone, defaultWin.data.productionDay);
                const at = (e: typeof w.from) =>
                  e.day === "today"
                    ? t("orders.plan.atToday", { time: e.time })
                    : e.day === "tomorrow"
                      ? t("orders.plan.atTomorrow", { time: e.time })
                      : t("orders.plan.atOther", { date: dayText(e.date, locale), time: e.time });
                return t("orders.plan.windowShown", { day: dayText(defaultWin.data.productionDay, locale), from: at(w.from), to: at(w.to) });
              })()}
            </p>
          ) : null}
          {twoPresses ? (
            <Field label={t("orders.plan.pressLine")}>
              <NativeSelect value={pressLineId} onChange={(e) => setPressLineId(e.target.value)} aria-label={t("orders.plan.pressLine")}>
                <option value="">{t("orders.plan.pickPressLine")}</option>
                {(pressLines.data ?? []).map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.code} · {pl.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </div>
      </Card>

      <div className="grid min-w-0 grid-cols-1 gap-4 min-[820px]:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-3" aria-label={t("orders.plan.openLines")}>
          <h3 className="m-0 text-[15px] font-semibold">{t("orders.plan.openLines")}</h3>
          <div className="flex flex-wrap gap-2">
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder={t("orders.plan.searchPlaceholder")}
              aria-label={t("orders.plan.searchLabel")}
              className="min-w-[12rem] flex-1"
            />
            <NativeSelect
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              aria-label={t("orders.customer")}
              className="min-w-[12rem] flex-1"
            >
              <option value="all">{t("orders.plan.allCustomers")}</option>
              {customers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {candidates.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : candidates.isError ? (
            <p role="alert" className="m-0 text-[14px] text-destructive">
              {t("errors.generic")}
            </p>
          ) : open.length === 0 ? (
            <EmptyState title={t("orders.plan.nothingLeft")} body={t("orders.plan.nothingLeftBody")} />
          ) : (
            <>
            {candidates.data?.more ? (
              <p role="status" data-more-lines="" className="m-0 text-[13px] leading-5 text-muted-foreground">
                {t("orders.plan.moreLines")}
              </p>
            ) : null}
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {open.flatMap((d) =>
                d.lines.map((l) => (
                  <li key={l.lineId} data-candidate={l.orderNumber}>
                    <Card size="sm" className="min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="m-0 font-mono text-[15px] font-semibold tabular-nums">
                            {dieTitle({ sectionCode: d.sectionCode, sectionName: l.sectionName, series: l.series })}
                          </p>
                          <p className="m-0 text-[14px] leading-5 break-words">
                            {l.orderNumber} · {l.customerName}
                            {l.poNumber ? ` · ${l.poNumber}` : ""}
                          </p>
                          <p className="m-0 font-mono text-[13px] leading-5 tabular-nums text-muted-foreground">
                            {label(l.cutLengthMm)} · {t("orders.plan.planable", { kg: orderKgText(l.strip.planableG) })}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setDraft((cur) => addPlanLine(cur, d.sectionId, l.lineId))} aria-label={t("orders.plan.addLine", { order: l.orderNumber })}>
                            {t("common.add")}
                          </Button>
                          {(soCount.get(l.orderId) ?? 0) > 1 ? (
                            <Button variant="ghost" data-add-all={l.orderNumber} onClick={() => setDraft((cur) => addPlanLines(cur, soLines(open, l.orderId)))}>
                              {t("orders.plan.addAllOfSo", { order: l.orderNumber })}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  </li>
                )),
              )}
            </ul>
            </>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3" aria-label={t("orders.plan.draftDies")}>
          <h3 className="m-0 text-[15px] font-semibold">{t("orders.plan.draftDies")}</h3>
          {draft.length > 1 || (draft.length === 1 && draft[0]!.lineIds.length > 1) ? (
            <SegmentedControl<PlanView>
              label={t("orders.plan.view.label")}
              value={view}
              onChange={setView}
              options={PLAN_VIEWS.map((v) => ({ value: v, label: t(`orders.plan.view.${v}`) }))}
            />
          ) : null}
          {draft.length === 0 ? (
            <EmptyState title={t("orders.plan.chooseLines")} body={t("orders.plan.chooseLinesBody")} />
          ) : view === "die" ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {draft.map((d, index) => {
                const first = infoOf(d.lineIds[0]!);
                const sectionCode = sectionById.get(d.sectionId)?.sectionCode ?? first?.sectionCode ?? "";
                return (
                  <li key={d.sectionId} data-draft-die={sectionCode}>
                    <Card size="sm" className="min-w-0">
                      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                        <CardTitle className="font-mono tabular-nums">
                          {index + 1}.{" "}
                          {dieTitle({ sectionCode, sectionName: first?.sectionName, series: first?.series })}
                        </CardTitle>
                        <div className="flex flex-wrap gap-2">
                          <Button variant={d.urgent ? "primary" : "secondary"} aria-pressed={d.urgent} onClick={() => setDraft((cur) => toggleUrgent(cur, d.sectionId))}>
                            {d.urgent ? t("press.plan.urgent") : t("orders.plan.markUrgent")}
                          </Button>
                          <Button variant="secondary" disabled={index === 0} onClick={() => setDraft((cur) => movePlanDie(cur, d.sectionId, -1))} aria-label={t("orders.plan.moveEarlier")}>
                            <ArrowUp aria-hidden="true" strokeWidth={2} />
                          </Button>
                          <Button variant="secondary" disabled={index === draft.length - 1} onClick={() => setDraft((cur) => movePlanDie(cur, d.sectionId, 1))} aria-label={t("orders.plan.moveLater")}>
                            <ArrowDown aria-hidden="true" strokeWidth={2} />
                          </Button>
                        </div>
                      </CardHeader>
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {d.lineIds.map((lineId) => draftLine(d.sectionId, lineId, false))}
                      </ul>
                    </Card>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0" data-draft-view={view}>
              {groups.map((g) => (
                <li key={g.key} data-draft-group={g.orderNumber ?? g.key}>
                  <Card size="sm" className="min-w-0">
                    {g.kind === "order" ? (
                      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                        <CardTitle className="font-mono tabular-nums">{g.orderNumber}</CardTitle>
                        <Link to="/orders/$id" params={{ id: orderIdOf(g.lines[0]!.lineId) ?? "" }} className="text-[13px] font-medium underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
                          {t("orders.plan.openOrder")}
                        </Link>
                      </CardHeader>
                    ) : null}
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">{g.lines.map((l) => draftLine(l.sectionId, l.lineId, true))}</ul>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {draft.length > 0 ? (
            <p data-draft-footer="" className="m-0 font-mono text-[13px] font-semibold tabular-nums">
              {t("orders.plan.draftFooter", { dies: counts.dies, lines: counts.lines })}
            </p>
          ) : null}
          {draft.length > 0 ? (
            <p data-draft-orders="" className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
              {t("orders.plan.draftOrders", { orders: orderCount })}
            </p>
          ) : null}
          {draft.length > 0 ? (
            <OtherLines
              rows={others.data?.lines ?? []}
              loading={others.isPending}
              failed={others.isError}
              more={others.data?.more ?? false}
              formatLength={label}
              onAdd={(row) => {
                const info = lineById.get(row.lineId);
                if (info) setKept((cur) => new Map(cur).set(row.lineId, info));
                setDraft((cur) => addPlanLine(cur, row.sectionId, row.lineId));
              }}
            />
          ) : null}
          {errors.length > 0 ? (
            <div role="alert" className="flex flex-col gap-1">
              {errors.map((e) => (
                <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
                  {e}
                </p>
              ))}
            </div>
          ) : null}
          <div>
            <Button
              onClick={() => {
                setErrors([]);
                create.mutate();
              }}
              disabled={!canCreate}
            >
              {create.isPending ? t("common.saving") : t("orders.plan.saveDraft")}
            </Button>
          </div>
        </section>
      </div>
    </section>
  );
}
