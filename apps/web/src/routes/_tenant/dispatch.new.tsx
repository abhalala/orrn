import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { TextArea } from "@orrn/ui/components/input";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CustomerPicker, type PickedCustomer } from "@/features/dispatch/customer-picker";
import { OrderPicker, type PickedOrder } from "@/features/dispatch/order-picker";
import { dispatchErrorText } from "@/features/dispatch/errors";
import { parseDayInput } from "@/features/dispatch/format";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

/** `?salesOrderId=…` opens the form on "From sales order" with that order picked (FP-PK-17). */
export const Route = createFileRoute("/_tenant/dispatch/new")({
  validateSearch: (search: Record<string, unknown>): { salesOrderId?: string } =>
    typeof search.salesOrderId === "string" && search.salesOrderId && search.salesOrderId.length <= 64 ? { salesOrderId: search.salesOrderId } : {},
  component: NewDispatchPage,
});

const NOTES_MAX = 500;

function NewDispatchPage() {
  const { t } = useT();
  return (
    <>
      <PageHeader
        back={{ to: "/dispatch", label: t("dispatch.title") }}
        title={t("dispatch.new.title")}
        actions={<HowToButton slug="build-dispatch" />}
      />
      <Can
        do="dispatch.create"
        fallback={
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("dispatch.new.noAccess")}
              action={
                <Button asChild variant="secondary">
                  <Link to="/dispatch">{t("dispatch.title")}</Link>
                </Button>
              }
            />
          </div>
        }
      >
        <NewDispatchForm />
      </Can>
    </>
  );
}

function NewDispatchForm() {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { salesOrderId } = Route.useSearch();
  const [mode, setMode] = useState<"customer" | "order">(salesOrderId ? "order" : "customer");
  const [order, setOrder] = useState<PickedOrder | null>(salesOrderId ? { id: salesOrderId, number: "", customerName: "" } : null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [shipDate, setShipDate] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<{ customer?: string; order?: string; notes?: string; form?: string }>({});
  const create = useMutation(trpc.dispatch.create.mutationOptions());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (mode === "customer" && !customer) next.customer = t("dispatch.new.customerRequired");
    if (mode === "order" && !order) next.order = t("dispatch.fromOrder.required");
    if (notes.length > NOTES_MAX) next.notes = t("errors.tooLong", { max: NOTES_MAX });
    setErrors(next);
    if ((mode === "customer" && !customer) || (mode === "order" && !order) || next.notes) return;
    create.mutate(
      {
        // From a sales order the party is the order's: only the order is sent (FP-PK-17).
        ...(mode === "order" ? { salesOrderId: order!.id } : { customerId: customer!.id }),
        shipDate: parseDayInput(shipDate),
        notes: notes.trim() || null,
      },
      {
        onSuccess: (res) => {
          toast.success(t("dispatch.new.created", { code: res.code }));
          void queryClient.invalidateQueries({ queryKey: trpc.dispatch.listDispatches.pathKey() });
          // Today counts open dispatches.
          void queryClient.invalidateQueries({ queryKey: trpc.dashboard.pathKey() });
          // Straight into Build.
          void navigate({ to: "/dispatch/$id", params: { id: res.id }, replace: true });
        },
        // In the reader's language (a removed customer, no access, offline), never the server's English.
        onError: (err) => setErrors({ form: dispatchErrorText(t, err) }),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex max-w-[560px] min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6">
        <SegmentedControl<"customer" | "order">
          label={t("dispatch.fromOrder.start")}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setErrors({});
          }}
          options={[
            { value: "customer", label: t("dispatch.fromOrder.byCustomer") },
            { value: "order", label: t("dispatch.fromOrder.tab") },
          ]}
        />
        {mode === "customer" ? (
          <CustomerPicker
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              setErrors((x) => ({ ...x, customer: undefined }));
            }}
            error={errors.customer}
          />
        ) : (
          <OrderPicker
            value={order}
            onChange={(o) => {
              setOrder(o);
              setErrors((x) => ({ ...x, order: undefined }));
            }}
            error={errors.order}
          />
        )}
        <Field
          label={`${t("dispatch.new.shipDate")} (${t("common.optional").toLowerCase()})`}
          hint={t("dispatch.new.shipDateHint")}
        >
          <TextInput type="date" value={shipDate} onChangeText={setShipDate} className="sm:max-w-[240px]" />
        </Field>
        <Field
          id="dispatch-notes"
          label={`${t("dispatch.new.notes")} (${t("common.optional").toLowerCase()})`}
          error={errors.notes}
        >
          <TextArea
            id="dispatch-notes"
            value={notes}
            onChangeText={setNotes}
            rows={3}
            maxLength={NOTES_MAX}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={errors.notes ? "dispatch-notes-error" : undefined}
          />
        </Field>
        {errors.form ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
            {errors.form}
          </p>
        ) : null}
      </div>
      <FormActions className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+12px)]">
        <Button asChild variant="secondary" className="max-sm:h-14">
          <Link to="/dispatch">{t("common.cancel")}</Link>
        </Button>
        <Button type="submit" loading={create.isPending} className="max-sm:h-14 max-sm:text-[17px]">
          {t("dispatch.new.submit")}
        </Button>
      </FormActions>
    </form>
  );
}
