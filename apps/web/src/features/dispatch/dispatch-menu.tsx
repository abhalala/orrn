import { dispatchActions, type DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@orrn/ui/components/dropdown-menu";
import { Field, TextInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Trash2, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { CustomerPicker } from "./customer-picker";
import { changedDetails, type DetailsFields as Fields } from "./edit-details";
import { dispatchErrorText } from "./errors";
import { isoDayInput } from "./format";
import { useCan } from "./hooks";
import { capacityKgText, changedTransport, parseCapacityKg, type TransportFields } from "./transport";
import { capacityErrorText, TransportFieldset } from "./transport-fields";

export type EditableDispatch = {
  id: string;
  code: string;
  status: DispatchStatus;
  shipDate: string | Date | null;
  notes: string | null;
  customerId: string;
  transporterId?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  vehicleCapacityG?: number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
};

/** The transport form values a dispatch row stands for. */
export function transportOf(d: EditableDispatch): TransportFields {
  return {
    transporterId: d.transporterId ?? "",
    vehicleNo: d.vehicleNo ?? "",
    driverName: d.driverName ?? "",
    driverPhone: d.driverPhone ?? "",
    capacityKg: capacityKgText(d.vehicleCapacityG),
    invoiceNumber: d.invoiceNumber ?? "",
    invoiceDate: d.invoiceDate ?? "",
  };
}

type Props = {
  dispatch: EditableDispatch;
  customerName: string;
  onChanged(): void;
};

type Pending = "cancel" | "delete" | "edit" | null;

/**
 * The dispatch's overflow ("More actions"): Edit details (Building), Cancel
 * dispatch and Delete dispatch, each offered only in states the server allows
 * (`dispatchActions`) and to roles that hold the action (each item sits in
 * `<Can>`; `useCan` only decides whether the menu exists). Cancel and Delete
 * ask first. Renders nothing when there is nothing to offer.
 */
export function DispatchMenu({ dispatch, customerName, onChanged }: Props) {
  const { t } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const actions = dispatchActions(dispatch.status);
  const [pending, setPending] = useState<Pending>(null);
  const cancel = useMutation(trpc.dispatch.cancel.mutationOptions());
  const remove = useMutation(trpc.dispatch.softDelete.mutationOptions());

  // Draft: everything. Held: the transport details only (the server edits the header until cancelled).
  const canEditHere = actions.canEdit || dispatch.status === "reserved";
  const offerEdit = canEditHere && can("dispatch.update");
  const offerCancel = actions.canCancel && can("dispatch.cancel");
  const offerDelete = actions.canDelete && can("dispatch.delete");
  if (!offerEdit && !offerCancel && !offerDelete) return null;

  const fail = (err: unknown) => toast.error(dispatchErrorText(t, err));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="secondary" label={t("common.moreActions")} icon={<MoreHorizontal strokeWidth={2} />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEditHere ? (
            <Can do="dispatch.update">
              <DropdownMenuItem onSelect={() => setPending("edit")}>
                <Pencil aria-hidden="true" strokeWidth={2} />
                {t("dispatch.detail.editDetails")}
              </DropdownMenuItem>
            </Can>
          ) : null}
          {offerEdit && (offerCancel || offerDelete) ? <DropdownMenuSeparator /> : null}
          {actions.canCancel ? (
            <Can do="dispatch.cancel">
              <DropdownMenuItem variant="destructive" onSelect={() => setPending("cancel")}>
                <XCircle aria-hidden="true" strokeWidth={2} />
                {t("dispatch.cancel")}
              </DropdownMenuItem>
            </Can>
          ) : null}
          {actions.canDelete ? (
            <Can do="dispatch.delete">
              <DropdownMenuItem variant="destructive" onSelect={() => setPending("delete")}>
                <Trash2 aria-hidden="true" strokeWidth={2} />
                {t("dispatch.delete")}
              </DropdownMenuItem>
            </Can>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pending === "cancel"}
        onOpenChange={(open) => !open && !cancel.isPending && setPending(null)}
        title={t("dispatch.cancelTitle")}
        description={t("dispatch.cancelBody")}
        actions={
          <>
            <Button variant="secondary" disabled={cancel.isPending} onClick={() => setPending(null)}>
              {t("common.back")}
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() =>
                cancel.mutate(
                  { id: dispatch.id },
                  {
                    onSuccess: () => {
                      toast.success(t("dispatch.cancelled"));
                      setPending(null);
                      onChanged();
                    },
                    onError: fail,
                  },
                )
              }
            >
              {t("dispatch.cancel")}
            </Button>
          </>
        }
      />

      <Dialog
        open={pending === "delete"}
        onOpenChange={(open) => !open && !remove.isPending && setPending(null)}
        title={t("dispatch.deleteTitle")}
        description={t("dispatch.deleteBody")}
        actions={
          <>
            <Button variant="secondary" disabled={remove.isPending} onClick={() => setPending(null)}>
              {t("common.back")}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { id: dispatch.id },
                  {
                    onSuccess: () => {
                      toast.success(t("dispatch.deleted"));
                      setPending(null);
                      onChanged();
                      void navigate({ to: "/dispatch", replace: true });
                    },
                    onError: fail,
                  },
                )
              }
            >
              {t("dispatch.delete")}
            </Button>
          </>
        }
      />

      {canEditHere ? (
        <Can do="dispatch.update">
          <EditDetailsSheet
            open={pending === "edit"}
            onOpenChange={(open) => setPending(open ? "edit" : null)}
            dispatch={dispatch}
            customerName={customerName}
            onSaved={onChanged}
          />
        </Can>
      ) : null}
    </>
  );
}

const NOTES_MAX = 500;


export function EditDetailsSheet({
  open,
  onOpenChange,
  dispatch,
  customerName,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  dispatch: Props["dispatch"];
  customerName: string;
  onSaved(): void;
}) {
  const { t } = useT();
  const fromDispatch = (): Fields => ({
    customer: { id: dispatch.customerId, name: customerName },
    shipDate: dispatch.shipDate ? isoDayInput(dispatch.shipDate) : "",
    notes: dispatch.notes ?? "",
  });
  const [fields, setFields] = useState<Fields>(fromDispatch);
  const [transport, setTransport] = useState<TransportFields>(() => transportOf(dispatch));
  const [error, setError] = useState<string | undefined>();
  const [capacityError, setCapacityError] = useState<string | undefined>();
  const can = useCan();
  // Customer, date and notes change only while Building; transport until the dispatch is cancelled.
  const baseEditable = dispatch.status === "draft";
  const completed = dispatch.status === "completed";
  const update = useMutation(trpc.dispatch.update.mutationOptions());
  // What the sheet showed when it opened: Save sends only what the person changed, so it
  // never puts back a value someone else changed meanwhile.
  const opened = useRef<Fields>(fields);
  const openedTransport = useRef<TransportFields>(transport);

  // Every open starts from the dispatch as it is now (Cancel discards edits and old errors).
  useEffect(() => {
    if (!open) return;
    const now = fromDispatch();
    opened.current = now;
    setFields(now);
    const tNow = transportOf(dispatch);
    openedTransport.current = tNow;
    setTransport(tNow);
    setCapacityError(undefined);
    setError(undefined);
    // Only on opening: a refetch while the sheet is open must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parseCapacityKg(transport.capacityKg) === undefined) {
      setCapacityError(capacityErrorText(t, transport.capacityKg));
      return;
    }
    const base = baseEditable ? changedDetails(opened.current, fields) : {};
    const moved = changedTransport(openedTransport.current, transport, { invoice: can("invoice.link") });
    if (Object.keys(base).length === 0 && Object.keys(moved).length === 0) {
      onOpenChange(false);
      return;
    }
    update.mutate(
      { id: dispatch.id, ...base, ...moved },
      {
        onSuccess: () => {
          toast.success(t("dispatch.detail.detailsSaved"));
          onOpenChange(false);
          onSaved();
        },
        onError: (err) => setError(dispatchErrorText(t, err)),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !update.isPending && onOpenChange(next)}
      title={t("dispatch.detail.editDetails")}
      footer={
        <>
          <Button variant="secondary" disabled={update.isPending} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="edit-dispatch-form" loading={update.isPending}>
            {t("dispatch.detail.saveDetails")}
          </Button>
        </>
      }
    >
      <form id="edit-dispatch-form" onSubmit={submit} className="flex flex-col gap-5 pt-1" noValidate>
        {baseEditable ? (
          <>
            <CustomerPicker value={fields.customer} onChange={(customer) => setFields((f) => ({ ...f, customer }))} allowNew={false} />
            <Field label={`${t("dispatch.new.shipDate")} (${t("common.optional").toLowerCase()})`} hint={t("dispatch.new.shipDateHint")}>
              <TextInput type="date" value={fields.shipDate} onChangeText={(shipDate) => setFields((f) => ({ ...f, shipDate }))} />
            </Field>
            <Field id="edit-dispatch-notes" label={`${t("dispatch.new.notes")} (${t("common.optional").toLowerCase()})`}>
              <TextArea
                id="edit-dispatch-notes"
                value={fields.notes}
                onChangeText={(notes) => setFields((f) => ({ ...f, notes }))}
                rows={3}
                maxLength={NOTES_MAX}
              />
            </Field>
          </>
        ) : null}
        <TransportFieldset
          value={transport}
          onChange={(next) => {
            setTransport(next);
            setCapacityError(undefined);
          }}
          show={{ vehicle: true, driver: true, capacity: true, invoice: true }}
          capacityError={capacityError}
          capacityLocked={completed}
        />
        {error ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
