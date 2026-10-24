/**
 * `/orders/new`: book a customer's PO. `orders.create` only books; the order is confirmed on its
 * own page once the PO number and every line are complete. Pieces <-> kg, the locked kg/12ft and
 * the basis note are the server's (`orders.quote`); the ready-stock prompt is `orders.matchStock`.
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
import { useRef, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { LineEditor } from "./components/line-editor";
import { CustomerField, type Picked } from "./components/pickers";
import { orderErrorLines } from "./errors";
import { useFloor, useShowRates } from "./hooks";
import { lineProblems, newLine, toLineInput, type LineDraft, type LineProblems } from "./line-model";

let lineSeq = 0;
const lineKey = () => `line-${(lineSeq += 1)}`;

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

  const [customer, setCustomer] = useState<Picked | null>(null);
  const [po, setPo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine(lineKey())]);
  const [tried, setTried] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // A retry after an unsure answer sends the same request id; an edited form gets a new one.
  const sent = useRef<{ id: string; body: string } | null>(null);

  const problems: Record<string, LineProblems> = {};
  for (const l of lines) problems[l.key] = lineProblems(l, unit);
  const complete = customer != null && lines.every((l) => Object.keys(problems[l.key]!).length === 0);

  const create = useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.orders.create.mutate>[0]) => trpcClient.orders.create.mutate(input),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: trpc.orders.list.queryKey() });
      toast.success(t("orders.form.saved", { number: res.number }));
      void navigate({ to: "/orders/$id", params: { id: res.id } });
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  function patchLine(key: string, patch: Partial<LineDraft>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function save() {
    setTried(true);
    setErrors([]);
    if (!complete || !customer) return;
    const body = {
      customerId: customer.id,
      poNumber: po.trim() || null,
      note: note.trim() || null,
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
          <div className="md:col-span-2">
            <Field label={t("common.note")}>
              <FieldTextArea value={note} onChangeText={setNote} rows={2} />
            </Field>
          </div>
        </div>
      </section>

      {lines.map((line, i) => (
        <LineEditor
          key={line.key}
          line={line}
          index={i}
          count={lines.length}
          unit={unit}
          customerId={customer?.id ?? null}
          dieBands={floor.dieBands}
          showRates={showRates}
          problems={tried ? problems[line.key] : undefined}
          onChange={(patch) => patchLine(line.key, patch)}
          onRemove={() => setLines((current) => current.filter((l) => l.key !== line.key))}
        />
      ))}

      <div>
        <Button variant="secondary" onClick={() => setLines((current) => [...current, newLine(lineKey())])}>
          <Plus aria-hidden="true" strokeWidth={2} />
          {t("orders.form.addLine")}
        </Button>
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
