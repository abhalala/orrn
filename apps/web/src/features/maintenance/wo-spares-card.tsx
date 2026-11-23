import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { StoreItemPicker } from "@/features/store/item-picker";
import { createRequestIds } from "@/features/store/request-id";
import { storeErrorKey } from "@/features/store/store-errors";
import { qtyProblemText, qtyText, unitShort } from "@/features/store/store-labels";
import { formatQty, isShort, parseQtyMilli, type StoreUnit } from "@/features/store/store-qty";
import { useInvalidateStore, useStoreBalances } from "@/features/store/use-store";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { can, useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { maintErrorKey } from "./model";
import { useInvalidateWo } from "./wo-hooks";
import { createIssueAttempts, issueSignature } from "./wo-model";
import { SpareRows, type SpareRow } from "./wo-parts";

type LinkedSpare = SpareRow & { itemName: string; unit: string; qtyMilli: number };

/** The spares on a work order: the linked store issues, "Issue from the store", and "Add a store issue". */
export function SparesCard({ workOrderId, status, spares }: { workOrderId: string; status: string; spares: readonly LinkedSpare[] }) {
  const { t } = useT();
  const fmt = useFmt();
  const when = useCompanyWhen();
  const { data: me } = useMe();
  const invalidate = useInvalidateWo();
  const [sheet, setSheet] = useState<"issue" | "add" | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const closed = status === "cancelled";
  const mayLink = can(me, "maint.workorder");

  const unlink = useMutation({
    mutationFn: (storeTxnId: string) => trpcClient.maint.spares.unlink.mutate({ workOrderId, storeTxnId }),
    onMutate: (id) => setPending(id),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("maint.workOrders.spares.removed"));
    },
    onError: (error) => toast.error(t(maintErrorKey(error))),
    onSettled: () => setPending(null),
  });

  return (
    <section aria-labelledby="wo-spares-title" data-testid="wo-spares-card" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id="wo-spares-title" className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">
          {t("maint.workOrders.spares.title")}
        </h2>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("maint.workOrders.spares.hint")}</p>
      </div>
      <SpareRows
        rows={spares}
        emptyText={t("maint.workOrders.spares.empty")}
        qtyText={(r) => {
          const s = r as LinkedSpare;
          return qtyText(t, s.qtyMilli, s.unit, fmt);
        }}
        when={when}
        actionLabel={mayLink && !closed ? t("maint.workOrders.spares.remove") : undefined}
        onAction={mayLink && !closed ? (r) => unlink.mutate(r.storeTxnId) : undefined}
        pendingId={pending}
      />
      {closed ? null : (
        <div className="flex flex-wrap gap-2">
          <Can do="store.txn">
            <Button variant="secondary" onClick={() => setSheet("issue")}>
              {t("maint.workOrders.spares.issueButton")}
            </Button>
          </Can>
          <Can do="maint.workorder">
            <Button variant="secondary" onClick={() => setSheet("add")}>
              {t("maint.workOrders.spares.addButton")}
            </Button>
          </Can>
        </div>
      )}
      {sheet === "issue" ? <IssueSheet workOrderId={workOrderId} onClose={() => setSheet(null)} /> : null}
      {sheet === "add" ? <AddSheet workOrderId={workOrderId} onClose={() => setSheet(null)} /> : null}
    </section>
  );
}

function AddSheet({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const when = useCompanyWhen();
  const invalidate = useInvalidateWo();
  const [pending, setPending] = useState<string | null>(null);
  const candidates = useQuery({ ...trpc.maint.spares.candidates.queryOptions({ workOrderId }), retry: false });
  const link = useMutation({
    mutationFn: (storeTxnId: string) => trpcClient.maint.spares.link.mutate({ workOrderId, storeTxnId }),
    onMutate: (id) => setPending(id),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("maint.workOrders.spares.added"));
    },
    onError: (error) => toast.error(t(maintErrorKey(error))),
    onSettled: () => setPending(null),
  });
  const rows = [...(candidates.data ?? [])].sort((a, b) => Number(b.forThis) - Number(a.forThis));
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={t("maint.workOrders.spares.addTitle")} description={t("maint.workOrders.spares.addSubtitle")}>
      {candidates.isPending ? (
        <Skeleton className="h-24 w-full rounded-card" />
      ) : candidates.isError ? (
        <EmptyState
          title={t(maintErrorKey(candidates.error))}
          action={
            <Button variant="secondary" onClick={() => void candidates.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : (
        <SpareRows
          rows={rows}
          emptyText={t("maint.workOrders.spares.addEmpty")}
          qtyText={(r) => {
            const c = rows.find((x) => x.storeTxnId === r.storeTxnId);
            return c ? qtyText(t, c.qtyMilli, c.unit, fmt) : "";
          }}
          when={when}
          actionLabel={t("maint.workOrders.spares.add")}
          onAction={(r) => link.mutate(r.storeTxnId)}
          pendingId={pending}
        />
      )}
    </Sheet>
  );
}

function IssueSheet({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const { data: me } = useMe();
  const balances = useStoreBalances(true);
  const invalidateStore = useInvalidateStore();
  const invalidateWo = useInvalidateWo();
  const attempts = useRef<ReturnType<typeof createIssueAttempts> | null>(null);
  if (!attempts.current) attempts.current = createIssueAttempts(createRequestIds());
  const issueAttempts = attempts.current;
  const [itemId, setItemId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const items = (balances.data?.items ?? []).filter((i) => i.active);
  const item = items.find((i) => i.id === itemId) ?? null;
  const parsed = parseQtyMilli(qty, (item?.unit ?? null) as StoreUnit | null);
  const itemError = !item ? t("store.form.itemRequired") : undefined;
  const signature = item && parsed.ok ? issueSignature(item.id, parsed.milli, workOrderId, note) : null;
  // An exact retry of a request already sent skips the balance check: the store may have issued the last unit with the answer lost.
  const retrying = signature !== null && issueAttempts.isRetry(signature);
  let qtyError: string | undefined;
  if (!parsed.ok) qtyError = qtyProblemText(t, parsed.problem);
  else if (item && !retrying && isShort(parsed.milli, item.balanceMilli))
    qtyError = t("store.form.qty.short", { qty: formatQty(Math.max(0, item.balanceMilli), item.unit, fmt), unit: unitShort(t, item.unit, item.balanceMilli, fmt) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (busy || !item || !parsed.ok || qtyError) return;
    setBusy(true);
    const trimmed = note.trim();
    const sig = issueSignature(item.id, parsed.milli, workOrderId, trimmed);
    // The same values send the same key until an outcome is known, so a retry after a lost answer never issues twice.
    const { clientRequestId } = issueAttempts.prepare(sig);
    issueAttempts.markSent(sig);
    try {
      const res = await trpcClient.store.issue.mutate({
        itemId: item.id,
        qtyMilli: parsed.milli,
        purpose: "maintenance",
        refId: workOrderId,
        note: trimmed || null,
        clientRequestId,
      });
      void invalidateStore();
      issueAttempts.settle();
      if (res.cancelled) {
        // A replay of an issue that was cancelled in the store: nothing was issued, so nothing is linked. The next try is a new request.
        toast.error(t("maint.workOrders.spares.issueCancelled", { number: res.number }));
        return;
      }
      if (can(me, "maint.workorder")) {
        try {
          await trpcClient.maint.spares.link.mutate({ workOrderId, storeTxnId: res.id });
          toast.success(t("maint.workOrders.spares.issued", { number: res.number }));
        } catch (error) {
          // The issue stands; it now waits in the candidates list.
          toast.error(t(maintErrorKey(error)));
        }
      } else {
        // A storekeeper may issue but not link: the issue waits in the candidates for maintenance.
        toast.success(t("maint.workOrders.spares.issuedNotLinked", { number: res.number }));
      }
      await invalidateWo();
      onClose();
    } catch (error) {
      toast.error(t(storeErrorKey(error)));
      void invalidateStore();
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (balances.isError && !balances.data) {
    body = (
      <EmptyState
        title={t("maint.workOrders.spares.issueRetry")}
        action={
          <Button variant="secondary" onClick={() => void balances.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  } else if (!balances.data) {
    body = <Skeleton className="h-24 w-full rounded-card" />;
  } else if (balances.data.locationId === null) {
    body = <EmptyState title={t("maint.workOrders.spares.issueNoLocation")} />;
  } else if (items.length === 0) {
    body = <EmptyState title={t("maint.workOrders.spares.issueNoItems")} />;
  } else {
    body = (
      <form id="wo-issue-form" className="flex min-w-0 flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field label={t("maint.workOrders.spares.issueItem")} required error={attempted ? itemError : undefined}>
          <StoreItemPicker items={items} recentIds={[]} value={itemId} takesStock onChange={setItemId} />
        </Field>
        <Field label={t("maint.workOrders.spares.issueQty")} required error={attempted || (item && parsed.ok) ? qtyError : undefined}>
          <TextInput inputMode="decimal" value={qty} onChangeText={setQty} />
        </Field>
        <Field label={t("maint.workOrders.spares.issueNote")} hint={t("maint.workOrders.spares.issueNoteHint")}>
          <TextInput value={note} maxLength={200} onChangeText={setNote} />
        </Field>
      </form>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      dismissible={!busy}
      title={t("maint.workOrders.spares.issueTitle")}
      description={t("maint.workOrders.spares.issueSubtitle")}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="wo-issue-form" loading={busy} disabled={!balances.data || items.length === 0}>
            {t("maint.workOrders.spares.issueSubmit")}
          </Button>
        </>
      }
    >
      {body}
    </Sheet>
  );
}
