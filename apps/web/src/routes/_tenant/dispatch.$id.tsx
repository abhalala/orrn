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
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ActionBar, AddActions, ItemsSection } from "@/features/dispatch/build-step";
import { CompleteSheet } from "@/features/dispatch/complete-sheet";
import { DispatchHeader } from "@/features/dispatch/dispatch-header";
import { DispatchMenu } from "@/features/dispatch/dispatch-menu";
import { dispatchErrorText } from "@/features/dispatch/errors";
import { GroupLabelSheet } from "@/features/dispatch/group-label-sheet";
import { dispatchTotals, type DispatchItem, type ItemGroup } from "@/features/dispatch/group-items";
import { HoldNote, ReleaseButton } from "@/features/dispatch/hold-step";
import { useCan, useCompanyTimeZone } from "@/features/dispatch/hooks";
import { PackingListView } from "@/features/dispatch/packing-list-view";
import { PasteSerialsSheet } from "@/features/dispatch/paste-serials-sheet";
import { SearchAddSheet } from "@/features/dispatch/search-add-sheet";
import { useFreshSerials } from "@/features/dispatch/use-fresh";
import { useScan, type AddBundlesReport } from "@/features/scan/scan-context";
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
  const timeZone = useCompanyTimeZone();
  const { data: me } = useMe();
  const unit: LengthUnit = me?.company?.settings?.lengthUnit === "inch" ? "inch" : "mm";
  const { fresh, mark } = useFreshSerials();

  const d = data.dispatch;
  const status = d.status;
  const items = data.items as DispatchItem[];
  const customerName = data.customer?.name ?? "";
  const totals = dispatchTotals(items);
  const actions = dispatchActions(status);
  const editable = status === "draft" || status === "reserved";

  const [sheet, setSheet] = useState<"paste" | "search" | "complete" | null>(null);
  const [labelGroup, setLabelGroup] = useState<ItemGroup | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: trpc.dispatch.getDispatch.queryKey({ id: d.id }) });
    void queryClient.invalidateQueries({ queryKey: trpc.dispatch.listDispatches.pathKey() });
  }, [queryClient, d.id]);

  const onAdded = useCallback(
    (report: AddBundlesReport) => {
      mark(report.added);
      refresh();
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
          refresh();
        },
        onError: (err) => {
          toast.error(dispatchErrorText(t, err));
          refresh();
        },
      },
    );

  const remove = async (item: DispatchItem) => {
    setRemoving(item.bundleId);
    try {
      await trpcClient.dispatch.removeBundle.mutate({ id: d.id, bundleId: item.bundleId });
      refresh();
      toast(t("dispatch.build.removed", { serial: item.serial }), {
        action: {
          label: t("dispatch.build.undo"),
          onClick: () => {
            void trpcClient.dispatch.addBundlesBySerial
              .mutate({ id: d.id, serials: [item.serial] })
              .then(onAdded)
              .catch((err: unknown) => toast.error(dispatchErrorText(t, err)));
          },
        },
      });
    } catch (err) {
      toast.error(dispatchErrorText(t, err));
      refresh();
    } finally {
      setRemoving(null);
    }
  };

  const inDispatch = useMemo(() => new Set(items.map((i) => i.serial)), [items]);
  const canAdd = editable && can("dispatch.addBundle");
  // From Building, Dispatch holds the stock first, so it needs both actions.
  const canComplete =
    (actions.canComplete && can("dispatch.complete")) ||
    (actions.canReserve && can("dispatch.complete") && can("dispatch.reserve"));
  const empty = items.length === 0;
  const emptyNote = empty ? t("dispatch.errors.empty") : undefined;

  const dispatchButton = canComplete ? (
    <Button
      size="lg"
      className="sm:h-11 sm:text-[15px]"
      disabled={empty}
      aria-describedby={empty ? "dispatch-action-note" : undefined}
      onClick={() => setSheet("complete")}
      aria-haspopup="dialog"
    >
      <Send aria-hidden="true" strokeWidth={2} />
      {t("dispatch.dispatchAction")}
    </Button>
  ) : null;

  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <BackLink />
        <div className="flex shrink-0 items-center gap-1">
          <HowToButton slug={status === "draft" ? "build-dispatch" : "hold-and-dispatch"} />
          <DispatchMenu dispatch={d} customerName={customerName} onChanged={refresh} />
        </div>
      </div>

      <DispatchHeader
        key={celebrate}
        code={d.code}
        status={status}
        customerName={customerName}
        shipDate={d.shipDate}
        completedAt={d.completedAt}
        bundles={totals.bundles}
        weightG={totals.weightG}
        timeZone={timeZone}
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
        />
      ) : null}

      {status === "completed" ? (
        <PackingListView dispatchId={d.id} />
      ) : (
        <ItemsSection
          items={items}
          unit={unit}
          fresh={fresh}
          canRemove={status === "draft" && canAdd}
          canLabel={canAdd}
          removing={removing}
          onRemove={(item) => void remove(item)}
          onEditLabel={setLabelGroup}
          emptyAction={
            status === "draft" && canAdd ? (
              <Button onClick={openScan} aria-haspopup="dialog">
                {t("dispatch.build.scanBundles")}
              </Button>
            ) : undefined
          }
        />
      )}

      {status === "draft" && (canComplete || can("dispatch.reserve")) ? (
        <ActionBar bundles={totals.bundles} weightG={totals.weightG} note={emptyNote}>
          <Can do="dispatch.reserve">
            <Button
              variant="secondary"
              size="lg"
              className="sm:h-11 sm:text-[15px]"
              loading={reserve.isPending}
              disabled={empty}
              aria-describedby={empty ? "dispatch-action-note" : undefined}
              onClick={hold}
            >
              {t("dispatch.holdStock")}
            </Button>
          </Can>
          {dispatchButton}
        </ActionBar>
      ) : null}

      {status === "reserved" && (canComplete || can("dispatch.reserve")) ? (
        <ActionBar bundles={totals.bundles} weightG={totals.weightG} note={emptyNote}>
          <Can do="dispatch.reserve">
            <ReleaseButton dispatchId={d.id} onReleased={refresh} />
          </Can>
          {dispatchButton}
        </ActionBar>
      ) : null}

      {canAdd ? (
        <>
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
          <GroupLabelSheet group={labelGroup} dispatchId={d.id} onOpenChange={(open) => !open && setLabelGroup(null)} onSaved={refresh} />
        </>
      ) : null}

      {canComplete && editable ? (
        <CompleteSheet
          open={sheet === "complete"}
          onOpenChange={(open) => setSheet(open ? "complete" : null)}
          dispatch={{ id: d.id, code: d.code, status }}
          customerName={customerName}
          items={items}
          onRefresh={refresh}
          onDispatched={() => {
            setCelebrate((n) => n + 1);
            toast.success(t("dispatch.detail.justDispatched", { code: d.code }));
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function DetailSkeleton() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">{t("dispatch.title")}</h1>
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton aria-hidden="true" className="h-11 w-32 rounded-full" />
      <Skeleton aria-hidden="true" className="h-[236px] w-full rounded-hero" />
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
