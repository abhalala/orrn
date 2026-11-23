/** The IRN and e-way bill panels on an invoice page. Both talk to the GST relay; with no relay they say so and keep the offline file. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Select } from "@orrn/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { saveTextFile } from "@/shared/lib/exports";
import { useFmt } from "@/shared/lib/fmt";
import { instantText } from "@/shared/lib/fmt-text";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { irnWord, type BillDoc, type DocActions } from "./model";
import { ReasonDialog } from "./reason-dialog";
import { errorText } from "./ui";

type Doc = BillDoc;

const REASON_CODES = ["1", "2", "3", "4"] as const;

function useRefresh(id: string) {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: trpc.billing.invoices.get.queryKey({ id }) }),
      qc.invalidateQueries({ queryKey: trpc.einvoice.status.queryKey({ id }) }),
      qc.invalidateQueries({ queryKey: trpc.billing.invoices.list.queryKey() }),
    ]);
  };
}

export function IrnPanel({ doc, actions }: { doc: Doc; actions: DocActions }) {
  const { t } = useT();
  const fmt = useFmt();
  const refresh = useRefresh(doc.id);
  const relay = useQuery({ ...trpc.einvoice.relayStatus.queryOptions(), retry: false });
  const status = useQuery({ ...trpc.einvoice.status.queryOptions({ id: doc.id }), retry: false });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [code, setCode] = useState<(typeof REASON_CODES)[number]>("2");

  const generate = useMutation({
    ...trpc.einvoice.generate.mutationOptions(),
    onSuccess: async (r) => {
      await refresh();
      if (r.outcome === "generated") toast.success(t("bill.irn.generated"));
      else toast.message(t("bill.irn.notYet"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });
  const cancel = useMutation({
    ...trpc.einvoice.cancelIrn.mutationOptions(),
    onSuccess: async () => {
      setCancelOpen(false);
      await refresh();
      toast.success(t("bill.irn.cancelled"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  const word = irnWord(doc.irn.status);
  const pendingNow = doc.status === "irn_pending";
  const off = relay.isError;
  return (
    <section aria-labelledby="bill-irn" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="bill-irn" className="m-0 text-[15px] font-semibold">
          {t("bill.irn.title")}
        </h2>
        <Chip tone={word === "generated" ? "green" : word === "failed" ? "red" : word === "cancelled" ? "neutral" : "amber"}>
          {pendingNow && word !== "failed" ? t("bill.status.irn_pending") : t(`bill.irn.words.${word}`)}
        </Chip>
      </div>
      {doc.irn.irn ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-muted-foreground">{t("bill.irn.irn")}</dt>
          <dd className="m-0 break-all font-mono">{doc.irn.irn}</dd>
          {doc.irn.ackNo ? (
            <>
              <dt className="text-muted-foreground">{t("bill.irn.ackNo")}</dt>
              <dd className="m-0 font-mono">{doc.irn.ackNo}</dd>
            </>
          ) : null}
          {doc.irn.ackDt ? (
            <>
              <dt className="text-muted-foreground">{t("bill.irn.ackDt")}</dt>
              <dd className="m-0 font-mono">{doc.irn.ackDt}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {doc.irn.error ? <p className="m-0 text-[13px]">{doc.irn.error}</p> : null}
      {word === "retrying" && doc.irn.nextTryAt ? <p className="m-0 text-[13px] text-muted-foreground">{t("bill.irn.nextTry", { when: instantText(fmt, doc.irn.nextTryAt) })}</p> : null}
      {relay.data && !relay.data.configured ? <p className="m-0 text-[13px] text-muted-foreground">{t("bill.irn.notSetUp")}</p> : null}
      {off ? <p className="m-0 text-[13px] text-muted-foreground">{t("bill.irn.moduleOff")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {actions.irnGenerate ? (
          <Can do="invoice.issue">
            <Button loading={generate.isPending} disabled={off || relay.data?.configured === false} onClick={() => generate.mutate({ id: doc.id })}>
              {word === "failed" ? t("common.retry") : t("bill.irn.generate")}
            </Button>
          </Can>
        ) : null}
        {doc.status === "cancel_pending" && status.data?.canCancelIrn ? (
          <Can do="invoice.cancel">
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              {t("bill.irn.cancel")}
            </Button>
          </Can>
        ) : null}
      </div>
      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("bill.irn.cancelTitle")}
        description={t("bill.irn.cancelHint")}
        confirmLabel={t("bill.irn.cancel")}
        danger
        pending={cancel.isPending}
        extra={
          <Field label={t("bill.irn.reasonCode")}>
            <Select value={code} onValueChange={(v) => setCode(v as (typeof REASON_CODES)[number])} options={REASON_CODES.map((c) => ({ value: c, label: t(`bill.irn.codes.${c}`) }))} placeholder={t("bill.irn.reasonCode")} />
          </Field>
        }
        onConfirm={(remark) => cancel.mutate({ id: doc.id, reasonCode: code, remark })}
      />
    </section>
  );
}

export function EwbPanel({ doc, actions }: { doc: Doc; actions: DocActions }) {
  const { t } = useT();
  const fmt = useFmt();
  const refresh = useRefresh(doc.id);
  const relay = useQuery({ ...trpc.einvoice.relayStatus.queryOptions(), retry: false });
  const status = useQuery({ ...trpc.einvoice.status.queryOptions({ id: doc.id }), retry: false });
  const snap = doc.snapshot;
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [km, setKm] = useState(String(snap.party.distanceKm ?? ""));
  const [vehicle, setVehicle] = useState(doc.ewb.vehicleNo ?? snap.vehicleNo ?? "");
  const [transporterId, setTransporterId] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [code, setCode] = useState<(typeof REASON_CODES)[number]>("2");
  const [tried, setTried] = useState(false);
  const [filing, setFiling] = useState(false);

  const kmNum = /^\d{1,4}$/.test(km.trim()) ? Number(km) : null;
  const vehicleOk = vehicle.trim().length >= 4;

  const generate = useMutation({
    ...trpc.einvoice.ewbGenerate.mutationOptions(),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
      toast.success(t("bill.ewb.generated"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });
  const cancel = useMutation({
    ...trpc.einvoice.ewbCancel.mutationOptions(),
    onSuccess: async () => {
      setCancelOpen(false);
      await refresh();
      toast.success(t("bill.ewb.cancelled"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  async function file() {
    setFiling(true);
    try {
      const r = await trpcClient.billing.export.ewbJson.query({ invoiceIds: [doc.id], distanceKm: kmNum ?? undefined, vehicleNo: vehicle.trim() || undefined });
      saveTextFile(r.fileName, r.json, "application/json");
    } catch (e) {
      toast.error(errorText(e, t("errors.generic")));
    } finally {
      setFiling(false);
    }
  }

  const active = doc.ewb.status === "active";
  const off = relay.isError;
  return (
    <section aria-labelledby="bill-ewb" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="bill-ewb" className="m-0 text-[15px] font-semibold">
          {t("bill.ewb.title")}
        </h2>
        <Chip tone={active ? "green" : doc.ewb.status === "cancelled" ? "neutral" : "amber"}>{t(`bill.ewb.words.${doc.ewb.status === "active" ? "active" : doc.ewb.status === "cancelled" ? "cancelled" : "none"}`)}</Chip>
        {status.data?.ewbNeeded && !active ? <span className="text-[13px] text-muted-foreground">{t("bill.ewb.needed")}</span> : null}
      </div>
      {active ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-muted-foreground">{t("bill.ewb.number")}</dt>
          <dd className="m-0 font-mono">{doc.ewb.number}</dd>
          {doc.ewb.validUntil ? (
            <>
              <dt className="text-muted-foreground">{t("bill.ewb.validUntil")}</dt>
              <dd className="m-0">{instantText(fmt, doc.ewb.validUntil)}</dd>
            </>
          ) : null}
          {doc.ewb.vehicleNo ? (
            <>
              <dt className="text-muted-foreground">{t("bill.ewb.vehicle")}</dt>
              <dd className="m-0 font-mono">{doc.ewb.vehicleNo}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!active && actions.ewbPanel ? (
          <Can do="invoice.issue">
            <Button disabled={off || relay.data?.configured === false} onClick={() => setOpen(true)}>
              {t("bill.ewb.generate")}
            </Button>
          </Can>
        ) : null}
        {active ? (
          <Can do="invoice.cancel">
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              {t("bill.ewb.cancel")}
            </Button>
          </Can>
        ) : null}
        {actions.ewbFile ? (
          <Can do="invoice.issue">
            <Button variant="secondary" loading={filing} onClick={() => void file()}>
              <FileDown aria-hidden="true" strokeWidth={2} />
              {t("bill.ewb.download")}
            </Button>
          </Can>
        ) : null}
      </div>
      {relay.data && !relay.data.configured ? <p className="m-0 text-[13px] text-muted-foreground">{t("bill.ewb.notSetUp")}</p> : null}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("bill.ewb.generate")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={generate.isPending}
              onClick={() => {
                setTried(true);
                if (kmNum === null || !vehicleOk) return;
                generate.mutate({ id: doc.id, distanceKm: kmNum, vehicleNo: vehicle.trim(), transporterId: transporterId.trim() || undefined, transporterName: transporterName.trim() || undefined });
              }}
            >
              {t("bill.ewb.generate")}
            </Button>
          </>
        }
      >
        <Field label={t("bill.ewb.distance")} error={tried && kmNum === null ? t("bill.ewb.distanceBad") : undefined}>
          <NumberInput value={km} onValueChange={setKm} decimal={false} suffix="km" />
        </Field>
        <Field label={t("bill.ewb.vehicle")} error={tried && !vehicleOk ? t("bill.ewb.vehicleBad") : undefined}>
          <TextInput value={vehicle} onChangeText={(v) => setVehicle(v.toUpperCase())} maxLength={15} />
        </Field>
        <Field label={t("bill.ewb.transporterId")}>
          <TextInput value={transporterId} onChangeText={setTransporterId} maxLength={15} />
        </Field>
        <Field label={t("bill.ewb.transporterName")}>
          <TextInput value={transporterName} onChangeText={setTransporterName} maxLength={100} />
        </Field>
      </Dialog>

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("bill.ewb.cancelTitle")}
        confirmLabel={t("bill.ewb.cancel")}
        danger
        pending={cancel.isPending}
        extra={
          <Field label={t("bill.irn.reasonCode")}>
            <Select value={code} onValueChange={(v) => setCode(v as (typeof REASON_CODES)[number])} options={REASON_CODES.map((c) => ({ value: c, label: t(`bill.irn.codes.${c}`) }))} placeholder={t("bill.irn.reasonCode")} />
          </Field>
        }
        onConfirm={(remark) => cancel.mutate({ id: doc.id, reasonCode: code, remark })}
      />
    </section>
  );
}
