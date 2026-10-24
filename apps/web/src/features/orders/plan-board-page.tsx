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
import { Field, TextInput } from "@orrn/ui/components/field";
import { Input } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";

import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { orderErrorLines } from "./errors";
import { dayTimeText, orderKgText } from "./format";
import { useMinWidth } from "./hooks";
import {
  addPlanLine,
  defaultWindow,
  dieTitle,
  fromLocalInput,
  movePlanDie,
  otherPartyNotes,
  removePlanLine,
  toggleUrgent,
  toLocalInput,
  windowState,
  type CandidateDie,
  type DraftDie,
} from "./view";

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

function PlanList() {
  const { t, locale } = useT();
  const plans = useQuery(trpc.plans.list.queryOptions({ limit: 20 }));
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={t("orders.plan.recent")}>
      <h2 className="m-0 text-[15px] font-semibold">{t("orders.plan.recent")}</h2>
      {plans.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : plans.isError ? (
        <p role="alert" className="m-0 text-[14px] text-destructive">
          {t("errors.generic")}
        </p>
      ) : plans.data.items.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("orders.plan.noPlans")}</p>
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
                  {t("press.plan.window", { from: dayTimeText(p.windowStart, locale), to: dayTimeText(p.windowEnd, locale) })}
                </span>
                <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                  {t("orders.plan.summary", { dies: p.dies, kg: orderKgText(p.kgG) })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlanBuilder() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { unit } = useLengthUnit();
  const candidates = useQuery(trpc.plans.candidates.queryOptions({ limit: 300 }));

  const [initial] = useState(() => defaultWindow(Date.now()));
  const [startText, setStartText] = useState(() => toLocalInput(initial.start));
  const [endText, setEndText] = useState(() => toLocalInput(initial.end));
  const [draft, setDraft] = useState<DraftDie[]>([]);
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("all");
  const [errors, setErrors] = useState<string[]>([]);

  const startMs = fromLocalInput(startText);
  const endMs = fromLocalInput(endText);
  const win = startMs == null || endMs == null ? "order" : windowState(startMs, endMs);

  const dies = candidates.data?.dies ?? [];
  const lineById = useMemo(() => {
    const m = new Map<string, (typeof dies)[number]["lines"][number] & { sectionId: string }>();
    for (const d of dies) for (const l of d.lines) m.set(l.lineId, { ...l, sectionId: d.sectionId });
    return m;
  }, [dies]);
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

  const asCandidates: CandidateDie[] = dies.map((d) => ({
    sectionId: d.sectionId,
    sectionCode: d.sectionCode,
    lines: d.lines.map((l) => ({
      lineId: l.lineId,
      customerId: l.customerId,
      customerName: l.customerName,
      poNumber: l.poNumber,
      orderNumber: l.orderNumber,
      planableG: l.strip.planableG,
    })),
  }));
  const notes = otherPartyNotes(draft, asCandidates);

  const create = useMutation({
    mutationFn: () =>
      trpcClient.plans.create.mutate({
        windowStart: startMs!,
        windowEnd: endMs!,
        dies: draft.map((d) => ({ sectionId: d.sectionId, urgent: d.urgent, lines: d.lineIds.map((salesOrderLineId) => ({ salesOrderLineId })) })),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: trpc.plans.list.queryKey() });
      await queryClient.invalidateQueries({ queryKey: trpc.plans.candidates.queryKey() });
      void navigate({ to: "/orders/plan/$id", params: { id: res.id } });
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  const label = (mm: number) => formatLengthMm(mm, unit);
  const canCreate = draft.length > 0 && win === "ok" && !create.isPending;

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
                setStartText(v);
                const ms = fromLocalInput(v);
                if (ms != null) setEndText(toLocalInput(ms + 24 * 3_600_000));
              }}
            />
          </Field>
          <Field
            label={t("orders.plan.to")}
            error={win === "long" ? t("orders.plan.windowLong") : win === "order" && endText ? t("orders.plan.windowOrder") : undefined}
            hint={t("orders.plan.windowHint")}
          >
            <TextInput type="datetime-local" value={endText} onChangeText={setEndText} />
          </Field>
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
                        <Button variant="secondary" onClick={() => setDraft((cur) => addPlanLine(cur, d.sectionId, l.lineId))} aria-label={t("orders.plan.addLine", { order: l.orderNumber })}>
                          {t("common.add")}
                        </Button>
                      </div>
                    </Card>
                  </li>
                )),
              )}
            </ul>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3" aria-label={t("orders.plan.draftDies")}>
          <h3 className="m-0 text-[15px] font-semibold">{t("orders.plan.draftDies")}</h3>
          {draft.length === 0 ? (
            <EmptyState title={t("orders.plan.chooseLines")} body={t("orders.plan.chooseLinesBody")} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {draft.map((d, index) => {
                const sec = sectionById.get(d.sectionId);
                return (
                  <li key={d.sectionId} data-draft-die={sec?.sectionCode}>
                    <Card size="sm" className="min-w-0">
                      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                        <CardTitle className="font-mono tabular-nums">
                          {index + 1}.{" "}
                          {sec
                            ? dieTitle({ sectionCode: sec.sectionCode, sectionName: lineById.get(d.lineIds[0]!)?.sectionName, series: lineById.get(d.lineIds[0]!)?.series })
                            : d.sectionId}
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
                        {d.lineIds.map((lineId) => {
                          const l = lineById.get(lineId);
                          if (!l) return null;
                          return (
                            <li key={lineId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                              <div className="min-w-0">
                                <p className="m-0 text-[14px] leading-5 break-words">
                                  {l.customerName}
                                  {l.poNumber ? ` · ${l.poNumber}` : ""}
                                </p>
                                <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
                                  {l.orderNumber} · {label(l.cutLengthMm)} · {orderKgText(l.strip.planableG)} {t("units.kg")}
                                </p>
                              </div>
                              <Button variant="ghost" onClick={() => setDraft((cur) => removePlanLine(cur, d.sectionId, lineId))}>
                                {t("common.remove")}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
          {notes.length > 0 ? (
            <div data-other-party="" className="flex flex-col gap-1 rounded-card border border-border bg-surface-sunken px-3 py-3">
              {notes.map((n) => (
                <p key={`${n.sectionId}-${n.orderNumber}`} className="m-0 text-[13px] leading-5">
                  {t("orders.plan.otherParty", {
                    die: n.sectionCode,
                    customer: n.customerName,
                    po: n.poNumber ?? n.orderNumber,
                    kg: orderKgText(n.planableG),
                  })}
                </p>
              ))}
            </div>
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
