import { dispatchActions, type DispatchStatus, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { UiLink } from "@orrn/ui/components/link";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Stepper } from "@orrn/ui/components/stepper";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { ChevronLeft, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { blockedCount } from "@/features/dispatch/blocked";
import { CapacityBanner } from "@/features/dispatch/capacity-banner";
import { ActionBar, AddActions, ItemsSection } from "@/features/dispatch/build-step";
import { REMOVE_ATTR } from "@/features/dispatch/bundle-groups";
import { CompleteSheet } from "@/features/dispatch/complete-sheet";
import { DispatchHeader } from "@/features/dispatch/dispatch-header";
import { DispatchMenu } from "@/features/dispatch/dispatch-menu";
import { dispatchErrorText } from "@/features/dispatch/errors";
import { GroupLabelSheet } from "@/features/dispatch/group-label-sheet";
import { dispatchTotals, type DispatchItem, type ItemGroup } from "@/features/dispatch/group-items";
import { HoldNote, PlPendingNote, ReleaseButton } from "@/features/dispatch/hold-step";
import { useCan, usePackingListScope } from "@/features/dispatch/hooks";
import { OrderPanel } from "@/features/dispatch/order-panel";
import { ValueCard } from "@/features/dispatch/value-card";
import { TruckPanel } from "@/features/dispatch/truck-panel";
import { PackingListView } from "@/features/dispatch/packing-list-view";
import { IssueCertificate } from "@/features/portal/issue-certificate";
import { PasteSerialsSheet } from "@/features/dispatch/paste-serials-sheet";
import { SearchAddSheet } from "@/features/dispatch/search-add-sheet";
import { SuggestSheet } from "@/features/dispatch/suggest-sheet";
import { useFreshSerials } from "@/features/dispatch/use-fresh";
import { useScan, type AddBundlesReport } from "@/features/scan/scan-context";
import { addOutcome, renderScanMessage } from "@/features/scan/scan-outcome";
import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/dispatch/$id")({
  component: DispatchDetailPage,
});

function BackLink() {
  const { t } = useT();
  return (
    <UiLink
      to="/dispatch"
      className="-ml-3 inline-flex min-h-11 items-center gap-1 self-start rounded-full pr-3 pl-2 text-[15px] font-semibold text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
    >
      <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
      {t("dispatch.title")}
    </UiLink>
  );
}

function DispatchDetailPage() {
  const { t } = useT();
  const { id } = Route.useParams();
  const query = useQuery({
    ...trpc.dispatch.getDispatch.queryOptions({ id }),
    retry: (count, error) => !isNotFound(error) && count < 2,
    // While a listed bundle is held elsewhere (or void), look again every 30 s: the other
    // dispatch may release it, and the mark should not outlive the reason.
    refetchInterval: (q) => {
      const data = q.state.data;
      return data && blockedCount(data.items as DispatchItem[], data.dispatch.status) > 0 ? 30_000 : false;
    },
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError && !query.data) {
    const missing = isNotFound(query.error);
    return (
      <>
        <BackLink />
        <h1 className="sr-only">{t("dispatch.title")}</h1>
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={missing ? t("errors.notFoundInCompany") : t("dispatch.detail.loadError")}
            action={
              missing ? (
                <Button asChild variant="secondary">
                  <Link to="/dispatch">{t("dispatch.title")}</Link>
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => void query.refetch()}>
                  {t("common.retry")}
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }
  return <DispatchDetail data={query.data} />;
}

type DetailData = inferRouterOutputs<AppRouter>["dispatch"]["getDispatch"];

const STEP_OF: Partial<Record<DispatchStatus, number>> = { draft: 0, reserved: 1 };

function DispatchDetail({ data }: { data: DetailData }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const scan = useScan();
  const can = useCan();
  const { data: me } = useMe();
  const unit: LengthUnit = me?.company?.settings?.lengthUnit === "inch" ? "inch" : "mm";
  const { fresh, mark } = useFreshSerials();

  const d = data.dispatch;
  const status = d.status;
  const items = data.items as DispatchItem[];
  const customerName = data.customer?.name ?? "";
  // The live rows while the load is built; the server's whole-load sums (the list's own) once nothing can change.
  const rowTotals = dispatchTotals(items);
  const totals = status === "completed" || status === "cancelled" ? { ...rowTotals, bundles: data.totals.bundles, weightG: data.totals.weightG } : rowTotals;
  const actions = dispatchActions(status);
  const editable = status === "draft" || status === "reserved";

  // Q37 per_truck: the packing lists on this truck; a lone dispatch can still take another customer.
  const scope = usePackingListScope();
  const truckData =
    data.truck ??
    (scope === "per_truck" && editable
      ? { id: d.id, dispatches: [{ id: d.id, code: d.code, status, plNumber: d.plNumber, customerName, bundles: totals.bundles, weightG: totals.weightG }] }
      : null);
  const [sheet, setSheet] = useState<"paste" | "search" | "suggest" | "complete" | null>(null);
  const [labelGroup, setLabelGroup] = useState<ItemGroup | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);

  /** Re-reads everything a dispatch action changes; resolves once this dispatch is read again. */
  const refresh = useCallback(() => {
    const self = queryClient.invalidateQueries({ queryKey: trpc.dispatch.getDispatch.queryKey({ id: d.id }) });
    void queryClient.invalidateQueries({ queryKey: trpc.dispatch.listDispatches.pathKey() });
    // Stock lists and bundle pages show held/dispatched state (completing also posts ledger rows);
    // Today and the volume chart show kg.
    void queryClient.invalidateQueries({ queryKey: trpc.bundle.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.stock.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.dashboard.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.analytics.pathKey() });
    return self;
  }, [queryClient, d.id]);

  const onAdded = useCallback(
    (report: AddBundlesReport) => {
      mark(report.added);
      void refresh();
    },
    [mark, refresh],
  );

  const openScan = () => scan.open({ kind: "dispatch", dispatchId: d.id, dispatchCode: d.code, onAdded });

  const reserve = useMutation(trpc.dispatch.reserve.mutationOptions());
  const hold = () =>
    reserve.mutate(
      { id: d.id },
      {
        onSuccess: () => {
          toast.success(t("dispatch.held"));
          void refresh();
        },
        onError: (err) => {
          toast.error(dispatchErrorText(t, err));
          void refresh();
        },
      },
    );

  // Undo puts the bundle back with its packing group label, or says why it can't come back
  // (another dispatch held it meanwhile).
  const undoRemove = async (item: DispatchItem) => {
    try {
      // Put back as it was: a bundle the office had added with no order goes back the same way (D12).
      const report = await trpcClient.dispatch.addBundlesBySerial.mutate({
        id: d.id,
        serials: [item.serial],
        ...(can("order.manage") ? { allowUnassigned: true } : {}),
      });
      const outcome = addOutcome(report, item.serial);
      if (outcome.kind === "rejected") {
        toast.error(renderScanMessage(t, outcome.message), { description: item.serial });
        return;
      }
      if (outcome.kind === "notFound") {
        toast.error(t("scan.notFound"), { description: item.serial });
        return;
      }
      if (outcome.kind === "added" && item.groupLabel) {
        await trpcClient.dispatch.setItemGroupLabel
          .mutate({ id: d.id, bundleId: item.bundleId, groupLabel: item.groupLabel })
          .catch(() => toast.error(t("dispatch.build.labelNotBack", { serial: item.serial, label: item.groupLabel ?? "" })));
      }
      onAdded(report);
    } catch (err) {
      toast.error(dispatchErrorText(t, err));
    }
  };

  const remove = async (item: DispatchItem) => {
    // Where focus goes once the row is gone: the next bundle's Remove, else the one before,
    // else the list heading (a removed row's button would drop focus to the page).
    const buttons = [...document.querySelectorAll<HTMLElement>(`[${REMOVE_ATTR}]`)];
    const at = buttons.findIndex((b) => b.getAttribute(REMOVE_ATTR) === item.serial);
    const nextSerial = at >= 0 ? ((buttons[at + 1] ?? buttons[at - 1])?.getAttribute(REMOVE_ATTR) ?? null) : null;
    setRemoving(item.bundleId);
    try {
      await trpcClient.dispatch.removeBundle.mutate({ id: d.id, bundleId: item.bundleId });
      await refresh();
      focusAfterRemove(item.serial, nextSerial);
      toast(t("dispatch.build.removed", { serial: item.serial }), {
        action: { label: t("dispatch.build.undo"), onClick: () => void undoRemove(item) },
      });
    } catch (err) {
      toast.error(dispatchErrorText(t, err));
      void refresh();
    } finally {
      setRemoving(null);
    }
  };

  const inDispatch = useMemo(() => new Set(items.map((i) => i.serial)), [items]);
  // Structure only (is there a bar at all); every control in it is wrapped in <Can>.
  const holdsActions = can("dispatch.complete") || can("dispatch.reserve");
  const empty = items.length === 0;
  const blocked = blockedCount(items, status);
  const stopped = empty || blocked > 0;
  const actionNote = empty
    ? t("dispatch.errors.empty")
    : blocked > 0
      ? t(status === "draft" ? "dispatch.build.blockedBuild" : "dispatch.build.blockedHeld", { count: blocked })
      : undefined;

  const dispatchPill = (
    <Button
      size="lg"
      className="sm:h-11 sm:text-[15px]"
      disabled={stopped}
      aria-describedby={stopped ? "dispatch-action-note" : undefined}
      onClick={() => setSheet("complete")}
      aria-haspopup="dialog"
      {...{ [NEXT_STEP_ATTR]: "" }}
    >
      <Send aria-hidden="true" strokeWidth={2} />
      {t("dispatch.dispatchAction")}
    </Button>
  );
  // From Building, Dispatch holds the stock first, so it needs both actions (ruling T22).
  const dispatchButton =
    status === "draft" ? (
      <Can do="dispatch.complete">
        <Can do="dispatch.reserve">{dispatchPill}</Can>
      </Can>
    ) : status === "reserved" ? (
      <Can do="dispatch.complete">{dispatchPill}</Can>
    ) : null;

  // Hold stock and Release leave with the state they belong to, and focus would fall to the
  // page. When the status changes and nothing has focus, it goes to this state's next step
  // (Dispatch once held, Hold stock once released), else the list heading. The packing list
  // takes focus itself after Dispatch.
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const next = document.querySelector<HTMLElement>(`[${NEXT_STEP_ATTR}]:not([disabled])`) ?? document.getElementById("dispatch-items");
    next?.focus();
  }, [status]);

  const onDispatched = () => {
    // The hero pops on its new colour: write the new status before celebrating, not after the refetch.
    queryClient.setQueryData(trpc.dispatch.getDispatch.queryKey({ id: d.id }), (old) =>
      old ? { ...old, dispatch: { ...old.dispatch, status: "completed" as const, completedAt: new Date().toISOString() } } : old,
    );
    setCelebrate((n) => n + 1);
    toast.success(t("dispatch.detail.justDispatched", { code: d.code }));
    void refresh();
  };

  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <BackLink />
        <div className="flex shrink-0 items-center gap-1">
          <HowToButton slug={status === "draft" ? "build-dispatch" : "hold-and-dispatch"} />
          <DispatchMenu dispatch={{ ...d, shipDay: data.shipDay }} customerName={customerName} onChanged={() => void refresh()} />
        </div>
      </div>

      <DispatchHeader
        key={celebrate}
        code={d.code}
        status={status}
        customerName={customerName}
        shipDay={data.shipDay}
        bundles={totals.bundles}
        weightG={totals.weightG}
        celebrate={celebrate > 0}
      />

      {STEP_OF[status] !== undefined ? (
        <Stepper
          steps={[t("dispatch.steps.build"), t("dispatch.steps.hold"), t("dispatch.steps.dispatch")]}
          current={STEP_OF[status]!}
        />
      ) : null}

      {editable && !can("dispatch.addBundle") ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("dispatch.detail.viewOnly")}</p>
      ) : null}

      {status === "reserved" ? <HoldNote customerName={customerName} /> : null}

      {editable ? (
        <AddActions
          emphasis={status === "draft" ? "primary" : "quiet"}
          onScan={openScan}
          onPaste={() => setSheet("paste")}
          onSearch={() => setSheet("search")}
          onSuggest={data.salesOrder ? () => setSheet("suggest") : undefined}
        />
      ) : null}

      {status !== "completed" ? <CapacityBanner capacity={data.capacity} /> : null}

      {truckData ? <TruckPanel truck={truckData} currentId={d.id} canAdd={editable} /> : null}

      {data.salesOrder && status !== "cancelled" ? <OrderPanel order={data.salesOrder} items={items} editable={editable} /> : null}

      {status !== "cancelled" ? <ValueCard value={data.value} /> : null}

      {status === "completed" ? (
        <>
          <PackingListView dispatchId={d.id} dispatch={d} customerName={customerName} focusTitle={celebrate > 0} />
          <IssueCertificate dispatchId={d.id} />
        </>
      ) : (
        <>
          {/* BACKLOG 85: no packing list yet; it is issued when the dispatch completes. */}
          {editable ? <PlPendingNote held={status === "reserved"} /> : null}
          <ItemsSection
            items={items}
            unit={unit}
            dispatchStatus={status}
            fresh={fresh}
            removable={status === "draft"}
            labelable={editable}
            removing={removing}
            onRemove={(item) => void remove(item)}
            onEditLabel={setLabelGroup}
          />
        </>
      )}

      {editable && holdsActions ? (
        <ActionBar bundles={totals.bundles} weightG={totals.weightG} note={actionNote}>
          <Can do="dispatch.reserve">
            {status === "draft" ? (
              <Button
                variant="secondary"
                size="lg"
                className="sm:h-11 sm:text-[15px]"
                loading={reserve.isPending}
                disabled={stopped}
                aria-describedby={stopped ? "dispatch-action-note" : undefined}
                onClick={hold}
                {...{ [NEXT_STEP_ATTR]: "" }}
              >
                {t("dispatch.holdStock")}
              </Button>
            ) : (
              <ReleaseButton dispatchId={d.id} onReleased={() => void refresh()} />
            )}
          </Can>
          {dispatchButton}
        </ActionBar>
      ) : null}

      {editable ? (
        <Can do="dispatch.addBundle">
          <PasteSerialsSheet
            open={sheet === "paste"}
            onOpenChange={(open) => setSheet(open ? "paste" : null)}
            dispatchId={d.id}
            onAdded={onAdded}
          />
          <SearchAddSheet
            open={sheet === "search"}
            onOpenChange={(open) => setSheet(open ? "search" : null)}
            dispatchId={d.id}
            inDispatch={inDispatch}
            onAdded={onAdded}
          />
          {data.salesOrder ? (
            <SuggestSheet open={sheet === "suggest"} onOpenChange={(open) => setSheet(open ? "suggest" : null)} dispatchId={d.id} unit={unit} onAdded={onAdded} />
          ) : null}
          <GroupLabelSheet
            group={labelGroup}
            dispatchId={d.id}
            onOpenChange={(open) => !open && setLabelGroup(null)}
            onSaved={() => void refresh()}
          />
        </Can>
      ) : null}

      {editable && (actions.canComplete || actions.canReserve) ? (
        <Can do="dispatch.complete">
          <CompleteSheet
            open={sheet === "complete"}
            onOpenChange={(open) => setSheet(open ? "complete" : null)}
            dispatch={{ id: d.id, code: d.code, status }}
            customerName={customerName}
            items={items}
            onRefresh={() => void refresh()}
            onDispatched={onDispatched}
            capacity={data.capacity}
          />
        </Can>
      ) : null}
    </>
  );
}

/** Marks the bar's next-step button (Hold stock while Building, Dispatch while Held) for focus. */
const NEXT_STEP_ATTR = "data-dispatch-next";

/**
 * After a Remove: once the row has left the screen (React Query renders on its own tick),
 * focus the next bundle's Remove, else the list heading. Leaves focus alone if the person
 * already moved it somewhere real.
 */
function focusAfterRemove(removed: string, next: string | null, tries = 20) {
  window.setTimeout(() => {
    const stillThere = document.querySelector(`[${REMOVE_ATTR}="${CSS.escape(removed)}"]`);
    if (stillThere && tries > 0) return focusAfterRemove(removed, next, tries - 1);
    const active = document.activeElement;
    if (active && active !== document.body && active !== stillThere) return;
    const target = (next ? document.querySelector<HTMLElement>(`[${REMOVE_ATTR}="${CSS.escape(next)}"]`) : null) ?? document.getElementById("dispatch-items");
    target?.focus();
  }, 50);
}

function DetailSkeleton() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">{t("dispatch.title")}</h1>
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton aria-hidden="true" className="h-11 w-32 rounded-full" />
      <Skeleton aria-hidden="true" className="h-[236px] w-full rounded-hero md:h-[176px]" />
      <Skeleton className="h-8 w-72 rounded-full" />
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Skeleton className="col-span-2 h-14 rounded-full sm:w-48" />
        <Skeleton className="h-11 rounded-full sm:w-40" />
        <Skeleton className="h-11 rounded-full sm:w-40" />
      </div>
      <Skeleton className="h-[260px] w-full rounded-card" />
    </div>
  );
}
