import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Merge, X } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { formatDay, nameKey, rupeesPerKg, vendorStatusView, type VendorStatus } from "./masters-model";
import { companyToday, FormError, MasterNote, MasterSection, MastersLoadError, MastersNoAccess, useMasterError } from "./masters-ui";
import { MergeVendorsSheet } from "./merge-vendors-sheet";
import { useInvalidate, useMastersAccess, type VendorDetail } from "./use-masters";
import { VendorSheet } from "./vendor-sheet";
import { vendorPath } from "./vendors-page";

type Lot = VendorDetail["recentLots"][number];

const LOT_STATUSES = ["booking", "unload", "ok", "cancelled"] as const;

/**
 * One vendor (route /vendors/$id): details, the other spellings the yard and the book use (add and
 * remove), usual items with last rates, and recent lots. Publishers edit, confirm a kanta draft,
 * archive or bring back, and merge duplicates into this vendor. A merged vendor says where it went.
 */
export function VendorPage({ id }: { id: string }) {
  const { t } = useT();
  const access = useMastersAccess();
  const invalidate = useInvalidate();
  const message = useMasterError();
  const vendor = useQuery({ ...trpc.vendor.get.queryOptions({ id }), enabled: access.canReadVendors });
  const items = useQuery(trpc.purchase.scrapItems.list.queryOptions());
  const keeperId = vendor.data?.vendor.mergedIntoId ?? null;
  const keeper = useQuery({ ...trpc.vendor.get.queryOptions({ id: keeperId ?? "" }), enabled: Boolean(keeperId) });
  const update = useMutation(trpc.vendor.update.mutationOptions());
  const confirm = useMutation(trpc.vendor.confirm.mutationOptions());
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const today = companyToday(access.me?.company?.settings?.timezone);
  const back = { to: "/vendors", label: t("vendors.title") };

  const itemName = useMemo(() => {
    const map = new Map((items.data?.items ?? []).map((i) => [i.id, i.name]));
    return (itemId: string) => map.get(itemId) ?? "-";
  }, [items.data]);

  if (!access.canReadVendors) {
    return (
      <>
        <PageHeader back={back} title={t("vendors.title")} />
        <MastersNoAccess titleKey="vendors.noAccess" bodyKey="vendors.noAccessBody" />
      </>
    );
  }

  if (vendor.isError && !vendor.data) {
    const missing = (vendor.error as { data?: { code?: string } } | null)?.data?.code === "NOT_FOUND";
    return (
      <>
        <PageHeader back={back} title={missing ? t("vendors.page.notFound") : t("vendors.title")} />
        {missing ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("vendors.page.notFound")}
              action={
                <Button asChild variant="secondary">
                  <Link to="/vendors">{t("vendors.title")}</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <MastersLoadError onRetry={() => void vendor.refetch()} />
        )}
      </>
    );
  }

  if (!vendor.data) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-5 w-48" />
        </div>
        <Skeleton className="h-32 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    );
  }

  const { vendor: v, aliases, usualItems, recentLots } = vendor.data;
  const status = v.status as VendorStatus;
  const view = vendorStatusView(status);
  const live = status !== "merged";

  const setArchived = async (archived: boolean) => {
    try {
      await update.mutateAsync({ id: v.id, status: archived ? "archived" : "active" });
      toast.success(t(archived ? "vendors.page.archived" : "vendors.page.restored", { name: v.name }));
      await invalidate.vendors();
    } catch (e) {
      toast.error(message(e));
    }
  };

  const doConfirm = async () => {
    try {
      await confirm.mutateAsync({ id: v.id });
      toast.success(t("vendors.page.confirmed", { name: v.name }));
      await invalidate.vendors();
    } catch (e) {
      toast.error(message(e));
    }
  };

  const lotColumns: ResponsiveListColumn<Lot>[] = [
    {
      key: "lot",
      header: t("vendors.page.columns.lot"),
      cell: (l) => <span className="font-mono whitespace-nowrap tabular-nums">{l.number}</span>,
    },
    {
      key: "date",
      header: t("vendors.page.columns.date"),
      cell: (l) => <span className="whitespace-nowrap tabular-nums">{formatDay(l.lotDate, today)}</span>,
    },
    { key: "item", header: t("vendors.page.columns.item"), cell: (l) => <span className="break-words">{itemName(l.scrapItemId)}</span> },
    {
      key: "rate",
      header: t("vendors.page.columns.rate"),
      align: "end",
      cell: (l) => (
        <span data-no-truncate="" className="font-mono tabular-nums">
          {t("vendors.page.ratePerKg", { rate: rupeesPerKg(l.ratePaise) })}
        </span>
      ),
    },
    {
      key: "status",
      header: t("vendors.page.columns.status"),
      cell: (l) => {
        const s = (LOT_STATUSES as readonly string[]).includes(l.status) ? (l.status as (typeof LOT_STATUSES)[number]) : "booking";
        const tone = s === "ok" ? "green" : s === "unload" ? "amber" : s === "cancelled" ? "red" : "neutral";
        return <Chip tone={tone}>{t(`vendors.page.lotStatus.${s}`)}</Chip>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        back={back}
        title={v.name}
        subtitle={[v.city, v.gstin].filter(Boolean).join(", ") || t("vendors.unregistered")}
        actions={
          live ? (
            <Can do="masters.publish">
              {status === "draft" ? (
                <Button onClick={() => void doConfirm()} loading={confirm.isPending}>
                  {t("vendors.page.confirm")}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setEditing(true)} aria-haspopup="dialog">
                {t("vendors.page.edit")}
              </Button>
              {status === "active" ? (
                <Button variant="secondary" onClick={() => setMerging(true)} aria-haspopup="dialog">
                  <Merge aria-hidden="true" strokeWidth={2} />
                  {t("vendors.page.mergeHere")}
                </Button>
              ) : null}
            </Can>
          ) : null
        }
      />

      {view.tone ? (
        <div>
          <Chip tone={view.tone}>{t(view.key)}</Chip>
        </div>
      ) : null}

      {status === "draft" ? <MasterNote tone="attention" body={t("vendors.page.draftNote")} /> : null}
      {status === "archived" ? (
        <MasterNote
          body={t("vendors.page.archivedNote")}
          action={
            <Can do="masters.publish">
              <Button variant="secondary" onClick={() => void setArchived(false)} loading={update.isPending}>
                {t("vendors.page.restore")}
              </Button>
            </Can>
          }
        />
      ) : null}
      {status === "merged" ? (
        <MasterNote
          body={t("vendors.page.mergedNote", { name: keeper.data?.vendor.name ?? "" })}
          action={
            keeperId && keeper.data ? (
              <Button asChild variant="secondary">
                <UiLink to={vendorPath(keeperId)}>{t("vendors.page.openKeeper", { name: keeper.data.vendor.name })}</UiLink>
              </Button>
            ) : null
          }
        />
      ) : null}

      <MasterSection id="vendor-details" title={t("vendors.page.details")}>
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 rounded-card border border-border bg-card p-4 sm:grid-cols-2 sm:p-5">
          <Fact label={t("vendors.page.gstin")} value={v.gstin} mono />
          <Fact label={t("vendors.page.phone")} value={v.phone} mono />
          <Fact label={t("vendors.page.city")} value={v.city} />
          <Fact label={t("vendors.page.notes")} value={v.notes} />
        </dl>
      </MasterSection>

      <MasterSection id="vendor-spellings" title={t("vendors.page.spellings")} hint={t("vendors.page.spellingsHint")}>
        <Spellings vendorId={v.id} aliases={aliases} editable={live} />
      </MasterSection>

      <MasterSection id="vendor-items" title={t("vendors.page.usualItems")} hint={t("vendors.page.usualItemsHint")}>
        {usualItems.length === 0 ? (
          <p className="m-0 rounded-card border border-border bg-card px-4 py-4 text-[15px] text-muted-foreground">
            {t("vendors.page.noLots")}
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
            {usualItems.map((u) => (
              <li key={u.scrapItemId} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card px-4 py-3">
                <span className="text-[15px] font-semibold break-words">{itemName(u.scrapItemId)}</span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-muted-foreground">
                  <span data-no-truncate="" className="tabular-nums">
                    {t("vendors.page.lastRate", { rate: t("vendors.page.ratePerKg", { rate: rupeesPerKg(u.lastRatePaise) }) })}
                  </span>
                  <span className="tabular-nums">{t("vendors.page.lotCount", { count: u.lots })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </MasterSection>

      {recentLots.length > 0 ? (
        <MasterSection id="vendor-lots" title={t("vendors.page.recentLots")}>
          <ResponsiveList
            rows={recentLots}
            columns={lotColumns}
            rowKey={(l) => l.id}
            rowHref={(l) => `/purchase/${encodeURIComponent(l.id)}`}
            label={t("vendors.page.recentLots")}
            empty={null}
          />
        </MasterSection>
      ) : null}

      {status === "active" ? (
        <Can do="masters.publish">
          <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => void setArchived(true)} loading={update.isPending}>
              {t("vendors.page.archive")}
            </Button>
          </div>
        </Can>
      ) : null}

      <VendorSheet open={editing} onOpenChange={setEditing} vendor={v} />
      <MergeVendorsSheet open={merging} onOpenChange={setMerging} keeper={{ id: v.id, name: v.name }} />
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className={value ? (mono ? "m-0 font-mono text-[15px] break-words" : "m-0 text-[15px] break-words") : "m-0 text-[15px] text-muted-foreground"}>
        {value || t("vendors.page.notGiven")}
      </dd>
    </div>
  );
}

/** Other spellings: each removable, one field to add another (masters.publish). */
function Spellings({
  vendorId,
  aliases,
  editable,
}: {
  vendorId: string;
  aliases: VendorDetail["aliases"];
  editable: boolean;
}) {
  const { t } = useT();
  const invalidate = useInvalidate();
  const message = useMasterError();
  const add = useMutation(trpc.vendor.addAlias.mutationOptions());
  const remove = useMutation(trpc.vendor.removeAlias.mutationOptions());
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (add.isPending) return;
    if (!nameKey(text)) {
      setFieldError(t("vendors.page.spellingRequired"));
      inputRef.current?.focus();
      return;
    }
    setFieldError(undefined);
    try {
      await add.mutateAsync({ vendorId, alias: text.trim() });
      toast.success(t("vendors.page.spellingAdded", { alias: text.trim() }));
      setText("");
      await invalidate.vendors();
      inputRef.current?.focus();
    } catch {
      // Shown under the field.
    }
  };

  const drop = async (alias: { id: string; alias: string }) => {
    try {
      await remove.mutateAsync({ id: alias.id });
      toast.success(t("vendors.page.spellingRemoved", { alias: alias.alias }));
      await invalidate.vendors();
    } catch (e) {
      toast.error(message(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      {aliases.length === 0 ? (
        <p className="m-0 text-[15px] text-muted-foreground">{t("vendors.page.noSpellings")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {aliases.map((a) => (
            <li
              key={a.id}
              className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border border-border bg-surface-sunken pl-3.5 text-[14px] font-medium"
            >
              <span className="min-w-0 break-words py-2">{a.alias}</span>
              {editable ? (
                <Can do="masters.publish" fallback={<span className="pr-3.5" />}>
                  <IconButton
                    label={t("vendors.page.removeSpelling", { alias: a.alias })}
                    icon={<X strokeWidth={2} className="size-4" />}
                    onClick={() => void drop(a)}
                    disabled={remove.isPending}
                    className="shrink-0"
                  />
                </Can>
              ) : (
                <span className="pr-3.5" />
              )}
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <Can do="masters.publish">
          <form noValidate onSubmit={(e) => void submit(e)} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label={t("vendors.page.spellingLabel")} error={fieldError}>
              <TextInput
                ref={inputRef}
                value={text}
                maxLength={120}
                autoComplete="off"
                onChangeText={(value) => {
                  setText(value);
                  if (fieldError && nameKey(value)) setFieldError(undefined);
                }}
              />
            </Field>
            <Button type="submit" variant="secondary" loading={add.isPending} className="sm:mt-[26px]">
              {t("vendors.page.addSpelling")}
            </Button>
          </form>
          <FormError error={add.error} />
        </Can>
      ) : null}
    </div>
  );
}
