import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { qtyProblemText, unitShort } from "@/features/store/store-labels";
import type { StoreUnit } from "@/features/store/store-qty";
import { StoreLoadError, StoreNote } from "@/features/store/store-ui";
import { useFmt } from "@/shared/lib/fmt";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { buyErrorText } from "./buy-errors";
import { rupees } from "./money";
import {
  buildPoInput,
  draftLineTotal,
  draftsFromIndent,
  draftsFromPo,
  draftTotals,
  emptyLine,
  MAX_PO_LINES,
  type HeaderDraft,
  type LineDraft,
  type PoFormProblems,
} from "./po-model";
import { StoreQtyBox } from "./qty-box";
import { useBuyAccess, useInvalidateBuy } from "./use-buy";

/** Case and spacing do not matter: "coverflux" finds "Cover flux". */
function key(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * A new purchase order (optionally filled from an approved indent), or a draft being changed
 * (`/store/po/new`, `/store/po/$id/edit`). Save goes to the order's own page, where it is sent.
 */
export function PoFormPage({ id, indentId }: { id?: string; indentId?: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const access = useBuyAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBuy();
  const editing = id !== undefined;

  const items = useQuery({ ...trpc.store.items.list.queryOptions(), enabled: access.manageOrders, meta: INLINE_ERROR_META });
  const vendors = useQuery({
    ...trpc.vendor.list.queryOptions({ status: "active", limit: 50 }),
    enabled: access.manageOrders,
    meta: INLINE_ERROR_META,
  });
  const po = useQuery({ ...trpc.store.po.get.queryOptions({ id: id ?? "" }), enabled: access.manageOrders && editing, meta: INLINE_ERROR_META });
  const indent = useQuery({
    ...trpc.store.indents.get.queryOptions({ id: indentId ?? "" }),
    enabled: access.manageOrders && !editing && Boolean(indentId),
    meta: INLINE_ERROR_META,
  });

  const [header, setHeader] = useState<HeaderDraft>({ vendorId: null, deliveryDate: "", terms: "", note: "" });
  const [vendorName, setVendorName] = useState<string | undefined>();
  const [lines, setLines] = useState<LineDraft[]>([emptyLine("l1")]);
  const [problems, setProblems] = useState<PoFormProblems | null>(null);
  const nextKey = useRef(2);
  const hydrated = useRef(false);

  // Fill the boxes once, when the order (or the indent) has loaded.
  useEffect(() => {
    if (hydrated.current) return;
    if (editing && po.data) {
      hydrated.current = true;
      setHeader({
        vendorId: po.data.po.vendorId,
        deliveryDate: po.data.po.deliveryDate ?? "",
        terms: po.data.po.terms ?? "",
        note: po.data.po.note ?? "",
      });
      setVendorName(po.data.vendor?.name);
      const drafts = draftsFromPo(po.data.lines);
      setLines(drafts.length > 0 ? drafts : [emptyLine("l1")]);
      // Above the fallback "l1" too, so the next added line never shares its key.
      nextKey.current = Math.max(2, drafts.length + 1);
    } else if (!editing && indent.data && items.data) {
      hydrated.current = true;
      const active = new Set(items.data.items.filter((i) => i.active).map((i) => i.id));
      const drafts = draftsFromIndent(indent.data.lines.filter((l) => active.has(l.itemId)));
      if (drafts.length > 0) setLines(drafts);
      // With no active item on the indent the first "l1" line stays: keep the counter above it.
      nextKey.current = Math.max(2, drafts.length + 1);
    }
  }, [editing, po.data, indent.data, items.data]);

  const unitById = useMemo(() => new Map((items.data?.items ?? []).map((i) => [i.id, i.unit as StoreUnit])), [items.data]);
  const unitOf = (itemId: string) => unitById.get(itemId) ?? null;
  const totals = draftTotals(lines, unitOf);

  const create = useMutation(trpc.store.po.create.mutationOptions());
  const update = useMutation(trpc.store.po.update.mutationOptions());
  // Held from the tap until the page moves on: the refetch after a save must not let a second create through.
  const [sending, setSending] = useState(false);
  const busy = sending || create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const back = { to: "/store/buy?tab=orders", label: t("store2.po.form.back") };
  const title = editing ? t("store2.po.form.editTitle") : t("store2.po.form.newTitle");
  const head = <PageHeader title={title} subtitle={t("store2.po.form.subtitle")} back={back} />;

  if (!access.manageOrders) {
    return (
      <>
        {head}
        <StoreNote body={t("store2.po.form.noAccess")} />
      </>
    );
  }
  if (showsQueryError(items) || showsQueryError(vendors) || (editing && showsQueryError(po)) || (!editing && indentId && showsQueryError(indent))) {
    return (
      <>
        {head}
        <StoreLoadError
          onRetry={() => {
            void items.refetch();
            void vendors.refetch();
            if (editing) void po.refetch();
            else if (indentId) void indent.refetch();
          }}
        />
      </>
    );
  }
  if (editing && po.data && po.data.po.status !== "draft") {
    return (
      <>
        {head}
        <EmptyState
          title={t("store2.po.form.notDraft", { number: po.data.po.number })}
          action={
            <Button asChild variant="secondary">
              <Link to="/store/po/$id" params={{ id: po.data.po.id }}>
                {t("store2.po.form.openOrder", { number: po.data.po.number })}
              </Link>
            </Button>
          }
        />
      </>
    );
  }
  if (!items.data || !vendors.data || (editing && !po.data) || (!editing && indentId && !indent.data)) {
    return (
      <>
        {head}
        <Skeleton className="h-64 rounded-card" />
      </>
    );
  }
  if (!editing && indent.data && indent.data.indent.status !== "approved") {
    return (
      <>
        {head}
        <StoreNote tone="attention" body={t("store2.po.form.indentNotUsable")} />
      </>
    );
  }

  const activeItems = items.data.items.filter((i) => i.active);
  const itemOptions = (list: typeof activeItems): ComboboxOption<string>[] =>
    list.map((i) => ({ value: i.id, label: i.name, hint: unitShort(t, i.unit, 2000, fmt) }));
  const vendorOptions: ComboboxOption<string>[] = vendors.data.items.map((v) => ({ value: v.id, label: v.name, hint: v.city ?? undefined }));

  const setLine = (k: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const built = buildPoInput(header, lines, unitOf);
    if (!built.ok) {
      setProblems(built.problems);
      return;
    }
    setProblems(null);
    setSending(true);
    try {
      if (editing && id) {
        await update.mutateAsync({ id, ...built.input });
        toast.success(t("store2.po.form.saved", { number: po.data?.po.number ?? "" }));
        await invalidate();
        void navigate({ to: "/store/po/$id", params: { id } });
      } else {
        const made = await create.mutateAsync({ ...built.input, ...(indentId ? { indentId } : {}) });
        toast.success(t("store2.po.form.saved", { number: made.number }));
        await invalidate();
        void navigate({ to: "/store/po/$id", params: { id: made.id } });
      }
    } catch {
      // Shown under the boxes (error).
    } finally {
      setSending(false);
    }
  };

  const lineProblemText = (k: string, which: "item" | "qty" | "rate" | "gst"): string | undefined => {
    const p = problems?.lines[k];
    if (!p) return undefined;
    if (which === "item") return p.item ? t("store2.po.form.itemRequired") : p.twice ? t("store2.po.form.sameItem") : undefined;
    if (which === "qty") return p.qty ? qtyProblemText(t, p.qty) : p.large ? t("store2.po.form.tooLarge") : undefined;
    if (which === "rate") return p.rate ? t("store2.po.form.rateInvalid") : undefined;
    return p.gst ? t("store2.po.form.gstInvalid") : undefined;
  };

  return (
    <>
      {head}
      {!editing && indent.data ? <StoreNote body={t("store2.po.form.fromIndent", { number: indent.data.indent.number })} /> : null}
      <form noValidate onSubmit={(e) => void save(e)} className="flex min-w-0 flex-col gap-6">
        <div className="grid min-w-0 gap-5 rounded-card border border-border bg-card p-4 sm:p-5 md:grid-cols-2">
          <Field label={t("store2.po.form.vendor")} hint={t("store2.po.form.vendorHint")} error={problems?.vendor ? t("store2.po.form.vendorRequired") : undefined} required>
            <Combobox<string>
              value={header.vendorId}
              onChange={(v) => {
                setHeader((h) => ({ ...h, vendorId: v }));
                setVendorName(undefined);
              }}
              placeholder={t("store2.po.form.vendorPlaceholder")}
              recent={vendorOptions}
              recentLabel={t("store2.po.form.vendor")}
              valueLabel={vendorName}
              label={t("store2.po.form.vendor")}
              search={async (q) => {
                const res = await queryClient.fetchQuery(trpc.vendor.list.queryOptions({ q, status: "active", limit: 20 }));
                return res.items.map((v) => ({ value: v.id, label: v.name, hint: v.city ?? undefined }));
              }}
            />
          </Field>
          <Field label={t("store2.po.form.delivery")} hint={t("store2.po.form.deliveryHint")} error={problems?.date ? t("store2.po.form.deliveryInvalid") : undefined}>
            <TextInput type="date" value={header.deliveryDate} onChangeText={(v) => setHeader((h) => ({ ...h, deliveryDate: v }))} />
          </Field>
          <Field label={t("store2.po.form.terms")} hint={t("store2.po.form.termsHint")}>
            <FieldTextArea value={header.terms} onChangeText={(v) => setHeader((h) => ({ ...h, terms: v }))} rows={3} maxLength={1000} />
          </Field>
          <Field label={t("store2.po.form.note")} hint={t("store2.po.form.noteHint")}>
            <FieldTextArea value={header.note} onChangeText={(v) => setHeader((h) => ({ ...h, note: v }))} rows={3} maxLength={500} />
          </Field>
        </div>

        <section aria-labelledby="po-lines" className="flex min-w-0 flex-col gap-3">
          <h2 id="po-lines" className="m-0 font-display text-[20px] font-bold leading-tight tracking-[-0.02em]">
            {t("store2.po.form.lines")}
          </h2>
          {problems?.noLines ? <p role="alert" className="m-0 text-[14px] font-medium text-destructive">{t("store2.po.form.noLines")}</p> : null}
          {problems?.tooMany ? <p role="alert" className="m-0 text-[14px] font-medium text-destructive">{t("store2.po.form.tooManyLines")}</p> : null}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {lines.map((line, index) => {
              const unit = line.itemId ? unitOf(line.itemId) : null;
              const lineTotal = draftLineTotal(line, unitOf);
              const picked = line.itemId ? items.data.items.find((i) => i.id === line.itemId) : undefined;
              return (
                <li key={line.key} aria-label={t("store2.po.form.line", { n: index + 1 })} className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
                  <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                    <Field label={t("store2.po.form.item")} error={lineProblemText(line.key, "item")}>
                      <Combobox<string>
                        value={line.itemId}
                        onChange={(v) => setLine(line.key, { itemId: v })}
                        placeholder={t("store2.po.form.itemPlaceholder")}
                        recent={itemOptions(activeItems)}
                        recentLabel={t("store2.po.form.lines")}
                        valueLabel={picked?.name}
                        label={t("store2.po.form.item")}
                        search={async (q) => {
                          const k = key(q);
                          return itemOptions(activeItems.filter((i) => key(i.name).includes(k)).slice(0, 50));
                        }}
                      />
                    </Field>
                    <Field label={t("store2.po.form.qty")} error={lineProblemText(line.key, "qty")}>
                      <StoreQtyBox
                        unit={unit}
                        value={line.qty}
                        onValueChange={(v) => setLine(line.key, { qty: v })}
                        suffix={unit && unit !== "kg" ? unitShort(t, unit, 2000, fmt) : undefined}
                        autoComplete="off"
                      />
                    </Field>
                    <Field
                      label={unit ? t("store2.po.form.rate", { unit: unitShort(t, unit, 1000) }) : t("store2.po.form.rateNoUnit")}
                      hint={t("store2.po.form.rateHint")}
                      error={lineProblemText(line.key, "rate")}
                    >
                      <NumberInput value={line.rate} onValueChange={(v) => setLine(line.key, { rate: v })} autoComplete="off" />
                    </Field>
                    <Field label={t("store2.po.form.gst")} error={lineProblemText(line.key, "gst")}>
                      <NumberInput value={line.gst} onValueChange={(v) => setLine(line.key, { gst: v })} suffix="%" autoComplete="off" />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="m-0 text-[14px] font-medium tabular-nums text-muted-foreground">
                      {lineTotal !== null ? t("store2.po.form.lineTotal", { total: rupees(lineTotal) }) : ""}
                    </p>
                    {lines.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("store2.po.form.removeLine", { n: index + 1 })}
                        onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 aria-hidden="true" strokeWidth={2} />
                        {t("common.remove")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {lines.length < MAX_PO_LINES ? (
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  const k = `l${nextKey.current++}`;
                  setLines((ls) => [...ls, emptyLine(k)]);
                }}
              >
                <Plus aria-hidden="true" strokeWidth={2} />
                {t("store2.po.form.addLine")}
              </Button>
            </div>
          ) : null}
        </section>

        <dl className="m-0 ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[15px] tabular-nums" aria-label={t("store2.po.form.total")}>
          <dt className="text-muted-foreground">{t("store2.po.form.amount")}</dt>
          <dd className="m-0 text-right">{rupees(totals.amountPaise)}</dd>
          <dt className="text-muted-foreground">{t("store2.po.form.gstTotal")}</dt>
          <dd className="m-0 text-right">{rupees(totals.gstPaise)}</dd>
          <dt className="font-bold">{t("store2.po.form.total")}</dt>
          <dd className="m-0 text-right font-bold">{rupees(totals.totalPaise)}</dd>
        </dl>

        {problems ? <p role="alert" className="m-0 text-[14px] font-medium text-destructive">{t("store2.po.form.fixErrors")}</p> : null}
        {error ? (
          <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
            {buyErrorText(t, error)}
          </p>
        ) : null}

        <FormActions>
          <Button asChild variant="secondary" size="lg">
            {editing && id ? (
              <Link to="/store/po/$id" params={{ id }}>
                {t("common.cancel")}
              </Link>
            ) : (
              <Link to="/store/buy" search={{ tab: "orders" }}>
                {t("common.cancel")}
              </Link>
            )}
          </Button>
          <Button type="submit" size="lg" loading={busy}>
            {t("store2.po.form.save")}
          </Button>
        </FormActions>
      </form>
    </>
  );
}
