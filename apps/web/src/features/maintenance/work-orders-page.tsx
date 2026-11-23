import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { trpc } from "@/shared/utils/trpc";

import { FieldSelect } from "./field-controls";
import { isPriority, isWoKind, isWoStatus, maintErrorKey, PRIORITY_TONE, WO_KINDS, WO_STATUS_TONE } from "./model";
import { AssetLoadError } from "./wo-parts";
import { WO_FILTERS, woFilterOf, type WoFilter, type WoSearch } from "./search";

const STEP = 50;

/** `/maintenance/work-orders`: the list, newest first. The status filter and one-machine filter are the URL's. */
export function WorkOrdersPage({ search, onSearch }: { search: WoSearch; onSearch: (next: WoSearch) => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const filter = woFilterOf(search);
  const list = useInfiniteQuery({
    ...trpc.maint.workOrders.list.infiniteQueryOptions(
      { status: filter, assetId: search.asset, limit: STEP },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
    retry: false,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  type Row = (typeof rows)[number];

  const filterLabel = (f: WoFilter) => (f === "live" ? t("maint.workOrders.filter.live") : f === "all" ? t("maint.workOrders.filter.all") : t(`maint.woStatus.${f}`));
  const pick = (f: WoFilter): WoSearch => ({ ...(search.asset ? { asset: search.asset } : {}), ...(f === "live" ? {} : { status: f }) });

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "number", header: t("maint.workOrders.cols.number"), cell: (r) => <span className="font-mono font-semibold whitespace-nowrap">{r.number}</span> },
    {
      key: "asset",
      header: t("maint.workOrders.cols.asset"),
      cell: (r) => (
        <span className="break-words">
          <span className="font-mono font-semibold whitespace-nowrap">{r.assetCode}</span>
          <span className="ml-1.5">{r.assetName}</span>
          <span className="block text-[13px] text-muted-foreground">{r.title}</span>
        </span>
      ),
    },
    { key: "kind", header: t("maint.workOrders.cols.kind"), hideOnPhone: true, cell: (r) => (isWoKind(r.kind) ? t(`maint.woKind.${r.kind}`) : r.kind) },
    {
      key: "priority",
      header: t("maint.workOrders.cols.priority"),
      cell: (r) =>
        isPriority(r.priority) ? (
          <Chip tone={PRIORITY_TONE[r.priority]} truncate={false}>
            {t(`maint.priority.${r.priority}`)}
          </Chip>
        ) : (
          r.priority
        ),
    },
    {
      key: "status",
      header: t("maint.workOrders.cols.status"),
      phoneWide: true,
      cell: (r) =>
        isWoStatus(r.status) ? (
          <Chip tone={WO_STATUS_TONE[r.status]} truncate={false}>
            {t(`maint.woStatus.${r.status}`)}
          </Chip>
        ) : (
          r.status
        ),
    },
    { key: "assignee", header: t("maint.workOrders.cols.assignee"), hideOnPhone: true, cell: (r) => r.assignedName ?? t("maint.workOrders.unassigned") },
    { key: "raised", header: t("maint.workOrders.cols.raised"), hideOnPhone: true, cell: (r) => <span className="whitespace-nowrap">{fmt.date(r.createdAt, { year: true })}</span> },
  ];

  return (
    <>
      <PageHeader
        title={t("maint.workOrders.title")}
        subtitle={t("maint.workOrders.subtitle")}
        actions={
          <Can do="maint.workorder">
            <NewWorkOrder initialAssetId={search.asset} />
          </Can>
        }
      />
      <div role="group" aria-label={t("maint.workOrders.filter.label")} className="flex flex-wrap gap-2" data-testid="wo-filters">
        {WO_FILTERS.map((f) => {
          const active = f === filter;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              data-filter={f}
              onClick={() => onSearch(pick(f))}
              className={cn(
                "animate-press inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,scale] duration-[var(--dur-fast)]",
                active ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-surface-sunken",
              )}
            >
              {filterLabel(f)}
            </button>
          );
        })}
      </div>
      {search.asset ? (
        <p className="m-0 flex flex-wrap items-center gap-3 text-[14px] text-muted-foreground">
          {t("maint.workOrders.onlyAsset")}
          <Button variant="ghost" size="sm" onClick={() => onSearch(filter === "live" ? {} : { status: filter })}>
            {t("maint.workOrders.allAssets")}
          </Button>
        </p>
      ) : null}
      {list.isError && !list.data ? (
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={t(list.error && (list.error as { data?: { code?: string } }).data?.code === "FORBIDDEN" ? maintErrorKey(list.error) : "maint.workOrders.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <ResponsiveList<Row>
            label={t("maint.workOrders.title")}
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            rowHref={(r) => `/maintenance/work-orders/${r.id}`}
            loading={list.isPending}
            empty={<EmptyState title={t("maint.workOrders.empty")} />}
          />
          {list.hasNextPage ? (
            <div>
              <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {t("maint.showMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

/** The "New work order" button and its sheet. On success it opens the new work order. */
function NewWorkOrder({ initialAssetId }: { initialAssetId?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {t("maint.workOrders.new.button")}
      </Button>
      {open ? <NewWorkOrderSheet initialAssetId={initialAssetId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewWorkOrderSheet({ initialAssetId, onClose }: { initialAssetId?: string; onClose: () => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const assets = useQuery(trpc.maint.assets.list.queryOptions());
  const people = useQuery(trpc.maint.workOrders.people.queryOptions());
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [kind, setKind] = useState<(typeof WO_KINDS)[number]>("breakdown");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [attempted, setAttempted] = useState(false);
  const create = useMutation({
    ...trpc.maint.workOrders.create.mutationOptions(),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: trpc.maint.workOrders.pathKey() });
      toast.success(t("maint.workOrders.new.created", { number: res.number }));
      onClose();
      void navigate({ to: "/maintenance/work-orders/$id", params: { id: res.id } });
    },
    onError: (error) => toast.error(t(maintErrorKey(error))),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (create.isPending || !assetId || title.trim() === "") return;
    create.mutate({
      assetId,
      kind,
      title: title.trim(),
      ...(isPriority(priority) ? { priority } : {}),
      ...(assignedTo ? { assignedTo } : {}),
    });
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o && !create.isPending) onClose();
      }}
      dismissible={!create.isPending}
      title={t("maint.workOrders.new.title")}
      description={t("maint.workOrders.new.subtitle")}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={create.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="wo-new-form" loading={create.isPending}>
            {t("maint.workOrders.new.submit")}
          </Button>
        </>
      }
    >
      <form id="wo-new-form" className="flex min-w-0 flex-col gap-4" onSubmit={submit}>
        <Field label={t("maint.workOrders.new.asset")} required error={attempted && !assetId ? t("maint.workOrders.new.assetRequired") : undefined}>
          <FieldSelect value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">{t("maint.workOrders.new.assetPlaceholder")}</option>
            {(assets.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </FieldSelect>
          {assets.isError && !assets.data ? <AssetLoadError error={assets.error} onRetry={() => void assets.refetch()} /> : null}
        </Field>
        <Field label={t("maint.workOrders.new.kind")}>
          <FieldSelect value={kind} onChange={(e) => setKind(e.target.value as (typeof WO_KINDS)[number])}>
            {WO_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`maint.woKind.${k}`)}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <Field
          label={t("maint.workOrders.new.what")}
          hint={t("maint.workOrders.new.whatHint")}
          required
          error={attempted && title.trim() === "" ? t("maint.workOrders.new.whatRequired") : undefined}
        >
          <TextInput value={title} maxLength={300} onChangeText={setTitle} />
        </Field>
        <Field label={t("maint.workOrders.new.priority")}>
          <FieldSelect value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">{t("maint.workOrders.new.priorityFromAsset")}</option>
            {(["high", "medium", "low"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`maint.priority.${p}`)}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("maint.workOrders.new.assignTo")}>
          <FieldSelect value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">{t("maint.workOrders.unassigned")}</option>
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </FieldSelect>
        </Field>
      </form>
    </Sheet>
  );
}
