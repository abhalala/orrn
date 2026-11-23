import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { PlantInput } from "@/shared/components/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { cutLengthText, dateText, diameterText, diameterVars, kgGrouped1, massUnit } from "@/shared/lib/fmt-text";
import { DIAMETER_MM, LENGTH_MM, MASS_KG } from "@/shared/lib/plant-input";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { blankReceive, mtcFileOk, receiveInput, sizeParts, type ReceiveDraft, type ReceiveField } from "./logs-model";
import { uploadMtc } from "./logs-mtc";
import { todayIn } from "./melt-times";
import { ErrorLine, FieldSelect, LoadFailed, useTimeZone } from "./ui";

type Row = inferRouterOutputs<AppRouter>["foundry"]["logs"]["receipts"]["items"][number];

/** `/foundry/logs`: bought-in log receipts, the "receive logs" sheet and the MTC upload and link. */
export function LogsScreen() {
  const { t } = useT();
  const fmt = useFmt();
  const [receiving, setReceiving] = useState(false);
  const [mtcFor, setMtcFor] = useState<{ id: string; number: string } | null>(null);
  const query = useQuery({ ...trpc.foundry.logs.receipts.queryOptions({ limit: 100 }), meta: INLINE_ERROR_META });
  const header = (
    <PageHeader
      title={t("fdy2.logs.title")}
      subtitle={t("fdy2.logs.subtitle")}
      back={{ to: "/casts", label: t("foundry.casts.title") }}
      actions={
        <Can do="foundry.logs">
          <Button onClick={() => setReceiving(true)} data-testid="logs-receive">{t("fdy2.logs.receive")}</Button>
        </Can>
      }
    />
  );
  if (showsQueryError(query)) return <>{header}<LoadFailed title={t("fdy2.logs.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const size = (r: Row) => {
    const dia = r.diameterMm ? diameterText(fmt, r.diameterMm, t("units.mm")) : "";
    const len = r.lengthMm ? cutLengthText(fmt, r.lengthMm) : "";
    const parts = sizeParts(r);
    return parts === "both" ? t("fdy2.logs.sizeBoth", { dia, len }) : parts === "diameter" ? dia : parts === "length" ? len : t("fdy2.logs.sizeNone");
  };
  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "number",
      header: t("fdy2.logs.col.number"),
      cell: (r) => (
        <UiLink to={`/casts/${r.castId}`} className="font-mono text-[16px] font-bold whitespace-nowrap" aria-label={t("fdy2.logs.castLink", { number: r.number })} data-testid="log-cast-link">
          {r.number}
        </UiLink>
      ),
    },
    { key: "vendor", header: t("fdy2.logs.col.vendor"), cell: (r) => <span className="break-words">{r.vendorName}</span> },
    { key: "alloy", header: t("fdy2.logs.col.alloy"), cell: (r) => <span className="font-mono">{r.alloy}</span> },
    { key: "day", header: t("fdy2.logs.col.day"), cell: (r) => dateText(fmt, `${r.receivedOn}T12:00:00Z`) },
    { key: "size", header: t("fdy2.logs.col.size"), cell: (r) => <span className="tabular-nums">{size(r)}</span> },
    { key: "pcs", header: t("fdy2.logs.col.pieces"), align: "end", cell: (r) => <span className="tabular-nums">{r.pcs}</span> },
    { key: "kg", header: t("fdy2.logs.col.weight"), align: "end", cell: (r) => <span className="tabular-nums">{kgGrouped1(fmt, r.kgG)} {massUnit(fmt)}</span> },
    { key: "vcast", header: t("fdy2.logs.col.vendorCast"), hideWhenEmpty: true, cell: (r) => (r.vendorCastNo ? <span className="font-mono break-words">{r.vendorCastNo}</span> : null) },
    { key: "challan", header: t("fdy2.logs.col.challan"), hideWhenEmpty: true, cell: (r) => (r.challanNo ? <span className="font-mono break-words">{r.challanNo}</span> : null) },
    {
      key: "mtc",
      header: t("fdy2.logs.col.mtc"),
      cell: (r) => (
        <span className="flex flex-wrap gap-2">
          {r.hasMtc ? <MtcLink id={r.id} /> : <span className="text-muted-foreground">{t("fdy2.logs.mtc.none")}</span>}
          <Can do="foundry.logs">
            <Button size="sm" variant="ghost" onClick={() => setMtcFor({ id: r.id, number: r.number })} data-testid="log-mtc-add">
              {r.hasMtc ? t("fdy2.logs.mtc.replace") : t("fdy2.logs.mtc.add")}
            </Button>
          </Can>
        </span>
      ),
    },
  ];
  return (
    <>
      {header}
      <ResponsiveList
        rows={query.data?.items ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        loading={query.isLoading}
        label={t("fdy2.logs.title")}
        empty={<EmptyState title={t("fdy2.logs.empty")} description={t("fdy2.logs.emptyBody")} />}
      />
      <ReceiveSheet open={receiving} onClose={() => setReceiving(false)} onReceived={(r) => setMtcFor(r)} />
      <MtcSheet receipt={mtcFor} onClose={() => setMtcFor(null)} afterReceive />
    </>
  );
}

/** The signed link to the certificate, opened in a new tab. */
function MtcLink({ id }: { id: string }) {
  const { t } = useT();
  const open = useMutation({
    mutationFn: () => trpcClient.foundry.logs.mtcUrl.query({ id }),
    onSuccess: (r) => {
      window.open(r.url, "_blank", "noopener,noreferrer");
    },
    onError: () => toast.error(t("fdy2.logs.mtc.openFailed")),
  });
  return (
    <Button size="sm" variant="secondary" loading={open.isPending} onClick={() => open.mutate()} data-testid="log-mtc-view">
      {t("fdy2.logs.mtc.view")}
    </Button>
  );
}

// --- Receive -------------------------------------------------------------------------------------------------------

function ReceiveSheet({ open, onClose, onReceived }: { open: boolean; onClose(): void; onReceived(r: { id: string; number: string }): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const zone = useTimeZone();
  const today = todayIn(zone);
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META, enabled: open });
  const activeAlloys = (alloys.data?.items ?? []).filter((a) => a.status === "active");
  const [form, setForm] = useState<ReceiveDraft>(() => blankReceive(today));
  const [vendorLabel, setVendorLabel] = useState("");
  const [tried, setTried] = useState(false);
  const labels = useRef(new Map<string, string>());
  const set = (patch: Partial<ReceiveDraft>) => setForm((f) => ({ ...f, ...patch }));
  const receive = useMutation(
    trpc.foundry.logs.receive.mutationOptions({
      onSuccess: (r) => {
        toast.success(t("fdy2.logs.form.received", { number: r.number }));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.logs.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.stock.pathKey() });
        close();
        onReceived({ id: r.id, number: r.number });
      },
    }),
  );
  const close = () => {
    setTried(false);
    setForm(blankReceive(today));
    setVendorLabel("");
    receive.reset();
    onClose();
  };
  const search = async (q: string): Promise<ComboboxOption<string>[]> => {
    const res = await queryClient.fetchQuery(trpc.vendor.list.queryOptions({ q, limit: 20, offset: 0 }));
    return res.items.map((v) => {
      labels.current.set(v.id, v.name);
      return { value: v.id, label: v.name, hint: v.city ?? undefined };
    });
  };
  const parsed = receiveInput(form, today);
  const field = (k: ReceiveField): string | undefined => (tried && !parsed.ok && (parsed.field === k || (k === "day" && parsed.field === "future")) ? t(`fdy2.logs.form.err.${parsed.field}`) : undefined);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : close())}
      title={t("fdy2.logs.form.title")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={receive.isPending}
            data-testid="logs-save"
            onClick={() => {
              setTried(true);
              if (!parsed.ok) return;
              receive.mutate(parsed.input);
            }}
          >
            {t("fdy2.logs.form.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("fdy2.logs.form.vendor")} error={field("vendor")}>
          <Combobox
            value={form.vendorId || null}
            valueLabel={vendorLabel}
            onChange={(id) => {
              set({ vendorId: id });
              setVendorLabel(labels.current.get(id) ?? "");
            }}
            search={search}
            placeholder={t("fdy2.logs.form.vendorPick")}
          />
        </Field>
        <Field label={t("fdy2.logs.form.alloy")} error={field("alloy")}>
          <FieldSelect value={form.alloyId} onChange={(e) => set({ alloyId: e.currentTarget.value })} data-testid="logs-alloy">
            <option value="">{t("fdy2.logs.form.alloyPick")}</option>
            {activeAlloys.map((a) => (
              <option key={a.id} value={a.id}>{a.code}</option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("fdy2.logs.form.day")} error={field("day")}>
          <TextInput type="date" value={form.receivedOn} max={today} onChange={(e) => set({ receivedOn: e.currentTarget.value })} data-testid="logs-day" />
        </Field>
        <Field label={t("fdy2.logs.form.diameter", diameterVars(fmt))} hint={t("common.optional")} error={field("diameter")}>
          <PlantInput spec={DIAMETER_MM} decimal={false} value={form.diameterMm} onValueChange={(v) => set({ diameterMm: v })} data-testid="logs-diameter" />
        </Field>
        <Field label={t("fdy2.logs.form.length")} hint={t("common.optional")} error={field("length")}>
          <PlantInput spec={LENGTH_MM} value={form.lengthMm} onValueChange={(v) => set({ lengthMm: v })} data-testid="logs-length" />
        </Field>
        <Field label={t("fdy2.logs.form.pcs")} error={field("pcs")}>
          <NumberInput value={form.pcs} onValueChange={(v) => set({ pcs: v })} data-testid="logs-pcs" />
        </Field>
        <Field label={t("fdy2.logs.form.weight")} error={field("kg")}>
          <PlantInput spec={MASS_KG} value={form.kg} onValueChange={(v) => set({ kg: v })} data-testid="logs-kg" />
        </Field>
        <Field label={t("fdy2.logs.form.vendorCast")} hint={t("common.optional")}>
          <TextInput value={form.vendorCastNo} maxLength={40} onChange={(e) => set({ vendorCastNo: e.currentTarget.value })} data-testid="logs-vendor-cast" />
        </Field>
        <Field label={t("fdy2.logs.form.challan")} hint={t("common.optional")}>
          <TextInput value={form.challanNo} maxLength={40} onChange={(e) => set({ challanNo: e.currentTarget.value })} data-testid="logs-challan" />
        </Field>
        <Field label={t("fdy2.logs.form.note")} hint={t("common.optional")}>
          <FieldTextArea value={form.note} maxLength={300} onChange={(e) => set({ note: e.currentTarget.value })} />
        </Field>
        <ErrorLine error={receive.error} />
      </div>
    </Sheet>
  );
}

// --- MTC upload ----------------------------------------------------------------------------------------------------

/** Pick a PDF or photo and send it in three steps. Opens after a receipt is made, or from a row. */
function MtcSheet({ receipt, onClose, afterReceive }: { receipt: { id: string; number: string } | null; onClose(): void; afterReceive?: boolean }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const upload = useMutation({
    mutationFn: (f: File) => uploadMtc({ receiptId: receipt!.id, file: f }),
    onSuccess: () => {
      toast.success(t("fdy2.logs.mtc.saved"));
      void queryClient.invalidateQueries({ queryKey: trpc.foundry.logs.pathKey() });
      close();
    },
  });
  const close = () => {
    setFile(null);
    setTried(false);
    upload.reset();
    onClose();
  };
  const bad = tried && (!file || !mtcFileOk(file.name));
  return (
    <Sheet
      open={receipt !== null}
      onOpenChange={(o) => (o ? undefined : close())}
      title={t("fdy2.logs.mtc.title")}
      description={receipt && afterReceive ? t("fdy2.logs.mtc.afterReceive", { number: receipt.number }) : undefined}
      dismissible={!upload.isPending}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close} disabled={upload.isPending}>{t("fdy2.logs.mtc.later")}</Button>
          <Button
            size="lg"
            loading={upload.isPending}
            data-testid="mtc-save"
            onClick={() => {
              setTried(true);
              if (!file || !mtcFileOk(file.name)) return;
              upload.mutate(file);
            }}
          >
            {upload.isPending ? t("fdy2.logs.mtc.uploading") : t("fdy2.logs.mtc.add")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("fdy2.logs.mtc.pick")} error={bad ? t("fdy2.logs.mtc.badFile") : undefined}>
          <input
            type="file"
            accept="application/pdf,image/*"
            className="block w-full text-[15px]"
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
            data-testid="mtc-file"
          />
        </Field>
        {upload.error ? <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">{t("fdy2.logs.mtc.failed")}</p> : null}
      </div>
    </Sheet>
  );
}
