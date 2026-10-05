import { useT, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import {
  canCancelEntry,
  entrySource,
  entryState,
  entryTone,
  exchangePartner,
  focusAfterPage,
  showMore,
} from "./store-entries";
import { storeErrorText } from "./store-errors";
import { purposeLabel, unitShort } from "./store-labels";
import { formatQty } from "./store-qty";
import { StoreLoadError } from "./store-ui";
import { useFormatWhen } from "./use-format-when";
import { useInvalidateStore, useStoreAccess, useStoreEntries, type StoreEntry } from "./use-store";

/** The server's cap on store.txns (no cursor yet: a `before` cursor is a plant/core follow-up). */
const MAX = 500;
const PAGE = 50;

function stateWord(t: Translate, entry: StoreEntry): string {
  const state = entryState(entry);
  if (state === "cancelled") return t("store.cancelled");
  return state === "received" ? t("store.kind.grn") : t("store.kind.mrs");
}

/** "+12.5 kg" / "−3 pcs"; a cancelled entry shows its quantity struck through, no sign. */
function SignedQty({ entry }: { entry: StoreEntry }) {
  const { t } = useT();
  const cancelled = entryState(entry) === "cancelled";
  const sign = cancelled ? "" : entry.kind === "grn" ? "+" : "−";
  return (
    <span data-no-truncate="" className={cancelled ? "text-muted-foreground line-through" : undefined}>
      <span className="font-mono font-medium tabular-nums">
        {sign}
        {formatQty(entry.qtyMilli)}
      </span>{" "}
      <span className="text-muted-foreground">{unitShort(t, entry.unit, entry.qtyMilli)}</span>
    </span>
  );
}

function EntryChip({ entry }: { entry: StoreEntry }) {
  const { t } = useT();
  return <Chip tone={entryTone(entry)}>{stateWord(t, entry)}</Chip>;
}

/** What the entry was for: purpose of an issue, challan of a delivery, or the exchange. */
function entryDetail(t: Translate, entry: StoreEntry): string {
  if (entry.exchangeId) return t("store.purpose.exchange");
  if (entry.kind === "mrs") return entry.purpose ? purposeLabel(t, entry.purpose) : "";
  return entry.grnRef ? t("store.entry.challanRef", { ref: entry.grnRef }) : "";
}

/**
 * The store register, newest first: GRNs and MRSs with cancelled ones marked. Each row opens the
 * entry (details and, for the storekeeper, "Cancel entry"). Shows `pageSize`, then older ones on request.
 */
export function StoreEntries({
  itemId,
  label,
  pageSize = 20,
}: {
  itemId?: string;
  label: string;
  /** How many to show first (the store page shows the latest 10; an item page 20). */
  pageSize?: number;
}) {
  const { t } = useT();
  const when = useFormatWhen();
  const [limit, setLimit] = useState(pageSize);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useStoreEntries({ itemId, limit });
  const rows = query.data?.items ?? [];
  const open = rows.find((r) => r.id === openId) ?? null;
  const listRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  // Rows on screen when "Show older entries" was pressed; focus moves to the first new one.
  const focusFrom = useRef<number | null>(null);
  const loadingMore = query.isFetching && query.isPlaceholderData;
  const more = showMore({ shown: rows.length, limit, max: MAX, isPlaceholderData: query.isPlaceholderData });

  useEffect(() => {
    if (focusFrom.current === null || query.isPlaceholderData || query.isFetching) return;
    const from = focusFrom.current;
    focusFrom.current = null;
    // Only when focus is still where the person left it (the button, or nowhere once it went).
    const active = document.activeElement;
    if (active !== moreRef.current && active !== document.body && active !== null) return;
    const id = focusAfterPage(
      from,
      rows.map((r) => r.id),
    );
    if (!id) return;
    listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`)?.focus();
  }, [rows, query.isPlaceholderData, query.isFetching]);

  if (query.isError && rows.length === 0) return <StoreLoadError onRetry={() => void query.refetch()} />;

  const columns: ResponsiveListColumn<StoreEntry>[] = [
    {
      key: "entry",
      header: t("store.columns.entry"),
      cell: (r) => (
        <button
          type="button"
          data-entry-id={r.id}
          aria-haspopup="dialog"
          aria-label={t("store.entry.open", { number: r.number })}
          onClick={() => setOpenId(r.id)}
          className="font-mono text-[15px] font-semibold whitespace-nowrap text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid"
        >
          {r.number}
        </button>
      ),
    },
    ...(itemId
      ? []
      : [
          {
            key: "item",
            header: t("store.columns.item"),
            cell: (r: StoreEntry) => <span className="break-words">{r.itemName}</span>,
          },
        ]),
    { key: "qty", header: t("store.columns.quantity"), align: "end", cell: (r) => <SignedQty entry={r} /> },
    { key: "status", header: t("store.columns.status"), cell: (r) => <EntryChip entry={r} /> },
    {
      key: "detail",
      header: t("store.columns.details"),
      hideOnPhone: true,
      cell: (r) => <span className="break-words text-muted-foreground">{entryDetail(t, r) || "-"}</span>,
    },
    {
      key: "when",
      header: t("store.columns.when"),
      cell: (r) => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{when(r.createdAt)}</span>,
    },
  ];

  return (
    <div ref={listRef} className="flex min-w-0 flex-col gap-3">
      <ResponsiveList
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={query.isLoading || (query.isFetching && query.isPlaceholderData)}
        label={label}
        empty={<EmptyState title={t("store.noEntries")} body={t("store.noEntriesBody")} />}
      />
      {more.button ? (
        // Not `loading`: that disables the button and drops keyboard focus to the page while the
        // next page loads. It stays focusable, says it is busy, and ignores presses meanwhile.
        <Button
          ref={moreRef}
          variant="secondary"
          className="self-center"
          aria-busy={loadingMore || undefined}
          onClick={() => {
            if (loadingMore) return;
            focusFrom.current = rows.length;
            setLimit((l) => Math.min(MAX, l + PAGE));
          }}
        >
          {loadingMore ? <Loader2 className="size-[18px] animate-spin" aria-hidden="true" /> : null}
          {t("store.showMore")}
        </Button>
      ) : null}
      {more.atCap ? (
        <p className="m-0 self-center text-[14px] text-muted-foreground">{t("store.showingLatest", { max: MAX })}</p>
      ) : null}
      <EntrySheet
        entry={open}
        partner={open ? exchangePartner(open, rows) : undefined}
        linkItem={!itemId}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-[15px] break-words">{children}</dd>
    </div>
  );
}

/** One entry: its facts, and for the storekeeper a two-step "Cancel entry" with a reason (RP15). */
function EntrySheet({
  entry,
  partner,
  linkItem,
  onOpenChange,
}: {
  entry: StoreEntry | null;
  partner: StoreEntry | undefined;
  linkItem: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useT();
  const when = useFormatWhen();
  const { canEnter } = useStoreAccess();
  const invalidate = useInvalidateStore();
  const reasonId = `cancel-reason-${useId().replace(/:/g, "")}`;
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const cancel = useMutation(trpc.store.cancel.mutationOptions());

  // Keep the last entry on screen while the sheet animates closed.
  const shown = useRef<{ entry: StoreEntry; partner?: StoreEntry } | null>(null);
  if (entry) shown.current = { entry, partner };
  const current = shown.current;

  const reset = () => {
    setConfirming(false);
    setReason("");
    setReasonError(undefined);
    cancel.reset();
  };

  const submitCancel = async () => {
    if (!current) return;
    if (!reason.trim()) {
      setReasonError(t("store.entry.reasonRequired"));
      reasonRef.current?.focus();
      return;
    }
    try {
      const res = await cancel.mutateAsync({ txnId: current.entry.id, reason: reason.trim() });
      toast.success(t("store.entry.cancelledToast", { number: res.number }));
      await invalidate();
      onOpenChange(false);
      reset();
    } catch {
      // Shown inline below (cancel.error). The entry may have changed (cancelled by someone else).
      void invalidate();
    }
  };

  const e = current?.entry;
  const cancellable = Boolean(e && canCancelEntry(e));
  // A melt's flux draw (PL-7 review): undone by cancelling the melt, never here.
  const source = e && !e.cancelledAt ? entrySource(e) : null;

  return (
    <Sheet
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={e?.number ?? ""}
      description={e ? stateWord(t, e) : undefined}
      footer={
        // Without store.txn there is no footer at all (an empty bar otherwise); Can still guards the buttons.
        e && cancellable && canEnter ? (
          <Can do="store.txn">
            {confirming ? (
              <>
                <Button variant="secondary" size="lg" onClick={reset}>
                  {t("store.entry.keep")}
                </Button>
                <Button variant="danger" size="lg" loading={cancel.isPending} onClick={() => void submitCancel()}>
                  {t("store.entry.cancel")}
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                onClick={() => {
                  setConfirming(true);
                  // After the field renders.
                  requestAnimationFrame(() => reasonRef.current?.focus());
                }}
              >
                {t("store.entry.cancel")}
              </Button>
            )}
          </Can>
        ) : undefined
      }
    >
      {e ? (
        <div className="flex flex-col gap-5 pt-1">
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-4">
            <Fact label={t("store.entry.item")}>
              {linkItem ? (
                <Link
                  to="/store/items/$id"
                  params={{ id: e.itemId }}
                  className="font-semibold text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
                >
                  {e.itemName}
                </Link>
              ) : (
                e.itemName
              )}
            </Fact>
            <Fact label={t("store.entry.quantity")}>
              <SignedQty entry={e} />
            </Fact>
            <Fact label={t("store.entry.when")}>
              <span className="tabular-nums">{when(e.createdAt)}</span>
            </Fact>
            {/* GRN and MRS numbers restart every financial year: the year tells two GRN-1s apart. */}
            {e.period ? <Fact label={t("store.entry.period")}>{e.period}</Fact> : null}
            {e.kind === "mrs" && e.purpose ? (
              <Fact label={t("store.entry.purpose")}>{purposeLabel(t, e.purpose)}</Fact>
            ) : null}
            {/* A draw's refId is the drawing record's id (a cast uuid), not something a person typed. */}
            {e.refId && !e.sourceType ? <Fact label={t("store.entry.ref")}>{e.refId}</Fact> : null}
            {e.grnRef ? <Fact label={t("store.entry.challan")}>{e.grnRef}</Fact> : null}
          </dl>
          {e.note ? (
            <dl className="m-0">
              <Fact label={t("store.entry.note")}>{e.note}</Fact>
            </dl>
          ) : null}
          {e.exchangeId && current?.partner ? (
            <p className="m-0 text-[14px] text-muted-foreground">
              {t("store.entry.exchangedWith", { number: current.partner.number })}
            </p>
          ) : null}
          {source ? (
            <p className="m-0 text-[14px] leading-6 text-muted-foreground break-words">
              {t("store.entry.belongsTo", { source: purposeLabel(t, source) })}
            </p>
          ) : null}
          {e.cancelledAt ? (
            <p className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
              {t("store.entry.cancelledBecause", { reason: e.cancelReason ?? "" })}
            </p>
          ) : null}
          {confirming && cancellable ? (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <Field
                label={t("store.entry.reason")}
                hint={t("store.entry.reasonHint")}
                error={reasonError}
                id={reasonId}
              >
                <TextArea
                  ref={reasonRef}
                  id={reasonId}
                  rows={2}
                  maxLength={500}
                  value={reason}
                  aria-required="true"
                  aria-invalid={reasonError ? true : undefined}
                  aria-describedby={`${reasonId}-hint${reasonError ? ` ${reasonId}-error` : ""}`}
                  onChangeText={(v) => {
                    setReason(v);
                    if (reasonError && v.trim()) setReasonError(undefined);
                  }}
                />
              </Field>
              <p className="m-0 text-[14px] leading-6 text-muted-foreground">
                {e.exchangeId ? `${t("store.entry.cancelBoth")} ` : ""}
                {t("store.entry.cancelEffect")}
              </p>
              {cancel.error ? (
                <p role="alert" className="m-0 text-[14px] font-medium text-destructive break-words">
                  {storeErrorText(t, cancel.error)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
