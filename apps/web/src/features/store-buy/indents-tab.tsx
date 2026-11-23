import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Qty } from "@/features/store/balances-list";
import { StoreLoadError } from "@/features/store/store-ui";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { buyErrorText } from "./buy-errors";
import { IndentSheet } from "./indent-sheet";
import { indentActions, indentTone, INDENT_STATUSES, knownStatus, type IndentStatus } from "./indent-model";
import { useInvalidateBuy, type IndentRow } from "./use-buy";

const LIMIT = 100;

/** Indents (`/store/buy`, row 69): the list by status, raise, and one sheet to read and decide. */
export function IndentsTab() {
  const { t } = useT();
  const fmt = useFmt();
  const [status, setStatus] = useState<IndentStatus | "">("");
  const [raising, setRaising] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const filterId = `indent-status-${useId().replace(/:/g, "")}`;

  const list = useQuery(trpc.store.indents.list.queryOptions({ ...(status ? { status } : {}), limit: LIMIT }));
  const rows = list.data?.items ?? [];

  const columns: ResponsiveListColumn<IndentRow>[] = [
    {
      key: "number",
      header: t("store2.indent.columns.number"),
      cell: (r) => (
        <button
          type="button"
          onClick={() => setOpenId(r.id)}
          aria-haspopup="dialog"
          className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[15px] font-semibold text-foreground underline underline-offset-4"
        >
          {r.number}
        </button>
      ),
    },
    { key: "department", header: t("store2.indent.columns.department"), cell: (r) => <span className="break-words">{r.department}</span> },
    {
      key: "neededBy",
      header: t("store2.indent.columns.neededBy"),
      cell: (r) => (r.neededBy ? fmt.date(r.neededBy) : <span className="text-muted-foreground">{t("store2.indent.notSet")}</span>),
    },
    { key: "items", header: t("store2.indent.columns.items"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.lines}</span> },
    { key: "status", header: t("store2.indent.columns.status"), cell: (r) => <StatusChip status={r.status} /> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={t("store2.indent.show")} id={filterId} className="min-w-[200px]">
          <NativeSelect id={filterId} value={status} onChange={(e) => setStatus(e.currentTarget.value as IndentStatus | "")}>
            <option value="">{t("store2.indent.all")}</option>
            {INDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`store2.status.indent.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Can do="indent.raise">
          <Button onClick={() => setRaising(true)} aria-haspopup="dialog">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("store2.indent.raise")}
          </Button>
        </Can>
      </div>

      {list.isError && !list.data ? (
        <StoreLoadError onRetry={() => void list.refetch()} />
      ) : (
        <>
          <ResponsiveList
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            label={t("store2.buy.tabs.indents")}
            empty={
              <EmptyState
                title={status ? t("store2.indent.empty.filtered") : t("store2.indent.empty.title")}
                body={status ? undefined : t("store2.indent.empty.body")}
                action={
                  !status ? (
                    <Can do="indent.raise">
                      <Button onClick={() => setRaising(true)} aria-haspopup="dialog">
                        {t("store2.indent.raise")}
                      </Button>
                    </Can>
                  ) : undefined
                }
              />
            }
          />
          {rows.length >= LIMIT ? (
            <p className="m-0 text-[14px] text-muted-foreground">{t("store2.indent.more", { count: String(LIMIT) })}</p>
          ) : null}
        </>
      )}

      <IndentSheet open={raising} onOpenChange={setRaising} onRaised={(id) => setOpenId(id)} />
      <IndentDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const { t } = useT();
  return <Chip tone={indentTone(status)}>{t(`store2.status.indent.${knownStatus(status)}`)}</Chip>;
}

type Ask = "reject" | "cancel" | null;

/** One indent: its lines, its order, and the buttons this person may use. */
function IndentDetail({ id, onClose }: { id: string | null; onClose(): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const me = useMe();
  const invalidate = useInvalidateBuy();
  const noteId = `indent-note-${useId().replace(/:/g, "")}`;
  const detail = useQuery({ ...trpc.store.indents.get.queryOptions({ id: id ?? "" }), enabled: id !== null });
  const [ask, setAsk] = useState<Ask>(null);
  const [text, setText] = useState("");
  const [needed, setNeeded] = useState(false);

  const done = (key: "approved" | "rejected" | "cancelled", number: string) => async () => {
    toast.success(t(`store2.indent.detail.${key}`, { number }));
    await invalidate();
    setAsk(null);
    setText("");
  };
  const approve = useMutation(trpc.store.indents.approve.mutationOptions());
  const reject = useMutation(trpc.store.indents.reject.mutationOptions());
  const cancel = useMutation(trpc.store.indents.cancel.mutationOptions());
  const busy = approve.isPending || reject.isPending || cancel.isPending;
  const error = approve.error ?? reject.error ?? cancel.error;

  useEffect(() => {
    setAsk(null);
    setText("");
    setNeeded(false);
    approve.reset();
    reject.reset();
    cancel.reset();
    // Reset per indent; the mutations are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const data = detail.data;
  const indent = data?.indent;
  const mine = !!indent && me.data?.user.id !== undefined && indent.createdBy === me.data.user.id;
  const actions = indent
    ? indentActions(indent.status, indent, { userId: me.data?.user.id ?? null, decide: true, manageOrders: true })
    : null;

  const run = async (kind: "approve" | "reject" | "cancel") => {
    if (!indent || busy) return;
    const note = text.trim();
    if (kind !== "approve" && note === "") {
      setNeeded(true);
      return;
    }
    try {
      if (kind === "approve") await approve.mutateAsync({ id: indent.id, ...(note ? { note } : {}) });
      else if (kind === "reject") await reject.mutateAsync({ id: indent.id, note });
      else await cancel.mutateAsync({ id: indent.id, reason: note });
      await done(kind === "approve" ? "approved" : kind === "reject" ? "rejected" : "cancelled", indent.number)();
      if (kind !== "approve") onClose();
    } catch {
      // Shown below.
    }
  };

  const footer =
    actions && indent ? (
      ask ? (
        <>
          <Button variant="secondary" size="lg" onClick={() => { setAsk(null); setNeeded(false); }}>
            {t("store2.indent.detail.back")}
          </Button>
          <Button size="lg" loading={busy} onClick={() => void run(ask)}>
            {ask === "reject" ? t("store2.indent.detail.confirmReject") : t("store2.indent.detail.confirmCancel")}
          </Button>
        </>
      ) : (
        <>
          {actions.cancel ? (
            // The server lets the raiser cancel (indent.raise) or any approver (indent.approve).
            <Can do={mine ? ["indent.raise", "indent.approve"] : "indent.approve"}>
              <Button variant="ghost" size="lg" onClick={() => setAsk("cancel")}>
                {t("store2.indent.detail.cancel")}
              </Button>
            </Can>
          ) : null}
          {actions.reject ? (
            <Can do="indent.approve">
              <Button variant="secondary" size="lg" onClick={() => setAsk("reject")}>
                {t("store2.indent.detail.reject")}
              </Button>
            </Can>
          ) : null}
          {actions.approve ? (
            <Can do="indent.approve">
              <Button size="lg" loading={busy} onClick={() => void run("approve")}>
                {t("store2.indent.detail.approve")}
              </Button>
            </Can>
          ) : null}
          {actions.makeOrder ? (
            <Can do="po.manage">
              <Button asChild size="lg">
                <Link to="/store/po/new" search={{ indent: indent.id }}>
                  {t("store2.indent.detail.makeOrder")}
                </Link>
              </Button>
            </Can>
          ) : null}
        </>
      )
    ) : undefined;

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={indent ? t("store2.indent.detail.title", { number: indent.number }) : t("store2.buy.tabs.indents")}
      dismissible={!busy}
      footer={footer}
    >
      <div className="flex flex-col gap-5 pt-1">
        {detail.isLoading ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : detail.isError || !data || !indent ? (
          <StoreLoadError onRetry={() => void detail.refetch()} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={indent.status} />
              <span className="text-[14px] text-muted-foreground">{t("store2.indent.detail.raisedOn", { date: fmt.date(new Date(indent.createdAt).getTime()) })}</span>
            </div>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[15px]">
              <dt className="text-muted-foreground">{t("store2.indent.detail.department")}</dt>
              <dd className="m-0 break-words">{indent.department}</dd>
              <dt className="text-muted-foreground">{t("store2.indent.detail.neededBy")}</dt>
              <dd className="m-0">{indent.neededBy ? fmt.date(indent.neededBy) : t("store2.indent.notSet")}</dd>
              <dt className="text-muted-foreground">{t("store2.indent.detail.reason")}</dt>
              <dd className="m-0 break-words">{indent.reason || t("store2.indent.detail.noReason")}</dd>
            </dl>

            <section aria-labelledby={`${noteId}-items`} className="flex flex-col gap-2">
              <h3 id={`${noteId}-items`} className="m-0 text-[14px] font-medium text-foreground">
                {t("store2.indent.detail.items")}
              </h3>
              <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border p-0">
                {data.lines.map((l) => (
                  <li key={l.id} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0 break-words">{l.itemName}</span>
                    <Qty milli={l.qtyMilli} unit={l.unit} />
                  </li>
                ))}
              </ul>
            </section>

            {data.po ? (
              <p className="m-0 text-[15px]">
                <span className="text-muted-foreground">{t("store2.indent.detail.order")}: </span>
                <Link to="/store/po/$id" params={{ id: data.po.id }} className="font-mono font-semibold underline underline-offset-4">
                  {data.po.number}
                </Link>
              </p>
            ) : null}
            {actions?.makeOrder ? (
              <Can do="po.manage">
                <p className="m-0 text-[14px] text-muted-foreground">{t("store2.indent.detail.makeOrderHint")}</p>
              </Can>
            ) : null}

            {ask ? (
              <Field
                label={ask === "reject" ? t("store2.indent.detail.rejectReason") : t("store2.indent.detail.cancelReason")}
                error={needed && text.trim() === "" ? (ask === "reject" ? t("store2.indent.detail.rejectRequired") : t("store2.indent.detail.cancelRequired")) : undefined}
                required
              >
                <TextArea value={text} rows={3} maxLength={500} onChangeText={setText} />
              </Field>
            ) : actions?.approve ? (
              <Can do="indent.approve">
                <Field label={t("store2.indent.detail.noteLabel")} hint={t("store2.indent.detail.noteHint")}>
                  <TextArea value={text} rows={2} maxLength={500} onChangeText={setText} />
                </Field>
              </Can>
            ) : null}

            {error ? (
              <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
                {buyErrorText(t, error)}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
