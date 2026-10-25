/**
 * `/orders/new`: book a customer's PO. `orders.create` only books; the order is confirmed on its
 * own page once the PO number and every line are complete. The form lists each die once with its
 * cut lengths under it (Enter in pieces or kg adds the next length, Shift+Enter another die); the
 * expected date starts at the order date plus the plant's lead days (15 unless set) and stays
 * editable. Pieces <-> kg, the locked kg/12ft and the basis note are the server's (`orders.quote`);
 * the ready-stock prompt is `orders.matchStock`.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { DieBlockCard, useOrderQuotes } from "./components/die-block";
import { CustomerField, type Picked } from "./components/pickers";
import {
  addRow,
  allLines,
  blockProblems,
  blocksComplete,
  defaultExpectedDate,
  duplicateRow,
  newBlock,
  patchRow,
  patchShared,
  removeRow,
  setBlockDie,
  todayYmd,
  NO_TOTALS,
  type DieBlock,
} from "./die-blocks";
import { orderErrorLines } from "./errors";
import { orderKgText, pcsText } from "./format";
import { useCompanyTimeZone, useFloor, useShowRates } from "./hooks";
import { toLineInput } from "./line-model";

let seq = 0;
const nextKey = (p: string) => `${p}-${(seq += 1)}`;

export function NewOrderPage() {
  const { t } = useT();
  return (
    <>
      <PageHeader
        title={t("orders.new")}
        subtitle={t("orders.form.subtitle")}
        back={{ to: "/orders", label: t("orders.title") }}
      />
      <Can
        do="order.manage"
        fallback={
          <div role="alert" className="rounded-card border border-border bg-card">
            <EmptyState title={t("errors.forbidden")} />
          </div>
        }
      >
        <NewOrderForm />
      </Can>
    </>
  );
}

function NewOrderForm() {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { unit } = useLengthUnit();
  const floor = useFloor();
  const showRates = useShowRates();
  const zone = useCompanyTimeZone();

  const [customer, setCustomer] = useState<Picked | null>(null);
  const [po, setPo] = useState("");
  const [note, setNote] = useState("");
  // Null = untouched: the expected date follows today plus the plant's lead days (Q8).
  const [expected, setExpected] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<DieBlock[]>(() => [newBlock(nextKey("block"), nextKey("row"))]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // A retry after an unsure answer sends the same request id; an edited form gets a new one.
  const sent = useRef<{ id: string; body: string } | null>(null);
  const onFocused = useCallback(() => setFocusKey(null), []);

  const expectedDefault = defaultExpectedDate(todayYmd(zone), floor.orderLeadDays);
  const expectedValue = expected ?? expectedDefault;

  const lines = allLines(blocks);
  // Every figure below (row quotes, block and order totals, shares) is the server's (review r1 I-1).
  const quoted = useOrderQuotes(blocks, unit);
  const quotes = quoted.rows;
  const order = quoted.order;
  const complete = customer != null && blocksComplete(blocks, unit);

  const create = useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.orders.create.mutate>[0]) => trpcClient.orders.create.mutate(input),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: trpc.orders.list.queryKey() });
      toast.success(t("orders.form.saved", { number: res.number }));
      void navigate({ to: "/orders/$id", params: { id: res.id } });
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  const setBlock = (key: string, fn: (b: DieBlock) => DieBlock) => setBlocks((cur) => cur.map((b) => (b.key === key ? fn(b) : b)));
  const addBlock = () => {
    const block = newBlock(nextKey("block"), nextKey("row"));
    setBlocks((cur) => [...cur, block]);
  };

  function save() {
    setTried(true);
    setErrors([]);
    if (!complete || !customer) return;
    const body = {
      customerId: customer.id,
      poNumber: po.trim() || null,
      note: note.trim() || null,
      expectedDate: expectedValue || null,
      lines: lines.map((l) => toLineInput(l, unit, showRates)),
    };
    const json = JSON.stringify(body);
    if (!sent.current || sent.current.body !== json) sent.current = { id: crypto.randomUUID(), body: json };
    create.mutate({ ...body, clientRequestId: sent.current.id });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
        <h2 className="m-0 text-[15px] font-semibold">{t("orders.form.party")}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CustomerField value={customer} onChange={setCustomer} error={tried && !customer ? t("orders.form.errors.customer") : undefined} />
          <Field label={t("orders.poNumber")} hint={t("orders.form.poHint")}>
            <TextInput value={po} onChangeText={setPo} placeholder={t("orders.form.poPlaceholder")} autoComplete="off" />
          </Field>
          <Field label={t("orders.expectedDate")} hint={t("orders.form.expectedHint", { days: floor.orderLeadDays })}>
            <TextInput type="date" value={expectedValue} onChangeText={(v) => setExpected(v)} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("common.note")}>
              <FieldTextArea value={note} onChangeText={setNote} rows={2} />
            </Field>
          </div>
        </div>
      </section>

      {blocks.map((block, i) => (
        <DieBlockCard
          key={block.key}
          block={block}
          index={i}
          count={blocks.length}
          unit={unit}
          customerId={customer?.id ?? null}
          dieBands={floor.dieBands}
          showRates={showRates}
          problems={tried ? blockProblems(block, unit) : undefined}
          quotes={quotes}
          totals={quoted.blocks.get(block.key) ?? NO_TOTALS}
          focusKey={focusKey}
          onFocused={onFocused}
          onDie={(die) => setBlock(block.key, (b) => setBlockDie(b, die))}
          onCopy={(copy) => setBlock(block.key, (b) => ({ ...b, copy }))}
          onShared={(patch) => setBlock(block.key, (b) => patchShared(b, patch))}
          onRow={(key, patch) => setBlock(block.key, (b) => patchRow(b, key, patch))}
          onAddRow={(afterKey) => {
            const key = nextKey("row");
            setBlock(block.key, (b) => addRow(b, key, afterKey));
            setFocusKey(key);
          }}
          onAddBlock={() => {
            addBlock();
          }}
          onDuplicate={(key) => {
            const next = nextKey("row");
            setBlock(block.key, (b) => duplicateRow(b, key, next));
            setFocusKey(next);
          }}
          onRemoveRow={(key) => setBlock(block.key, (b) => removeRow(b, key))}
          onRemoveBlock={() => setBlocks((cur) => cur.filter((b) => b.key !== block.key))}
        />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" data-add-die="" onClick={addBlock}>
          <Plus aria-hidden="true" strokeWidth={2} />
          {t("orders.form.block.addDie")}
        </Button>
        {order.lines > 0 ? (
          <p data-order-total="" className="m-0 font-mono text-[15px] font-semibold tabular-nums" aria-live="polite">
            {t("orders.form.orderTotal", { lines: order.lines, pcs: pcsText(order.pcs), kg: orderKgText(order.kgG) })}
            {order.pending ? ` ${t("orders.form.quoting")}` : ""}
          </p>
        ) : null}
      </div>

      {errors.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 rounded-card border border-destructive/40 px-3 py-3">
          {errors.map((e) => (
            <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
              {e}
            </p>
          ))}
        </div>
      ) : null}

      <FormActions>
        <Button onClick={save} disabled={create.isPending}>
          {create.isPending ? t("common.saving") : t("orders.form.book")}
        </Button>
      </FormActions>
    </div>
  );
}
