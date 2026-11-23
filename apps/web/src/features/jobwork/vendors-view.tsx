import { finishProcesses } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useFmt } from "@/shared/lib/fmt";
import { kgWithUnit, rateText } from "@/shared/lib/fmt-text";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useJobworkInvalidate, useSeesCost, useVendors, type Vendor } from "./hooks";
import { MAX_PAISE, paiseDraft, paiseOf, processWord } from "./model";
import { FormSheet } from "./ui";

type Draft = { code: string; name: string; gstin: string; address: string; state: string; phone: string; processes: string[]; rate: string; active: boolean; note: string };

const EMPTY: Draft = { code: "", name: "", gstin: "", address: "", state: "", phone: "", processes: [], rate: "", active: true, note: "" };

const draftOf = (v: Vendor): Draft => ({
  code: v.code,
  name: v.name,
  gstin: v.gstin ?? "",
  address: v.address ?? "",
  state: v.state ?? "",
  phone: v.phone ?? "",
  processes: [...v.processes],
  rate: paiseDraft(v.ratePaisePerKg),
  active: v.active,
  note: v.note ?? "",
});

/** The vendors tab (`jobwork.masters`): each vendor owns a place of kind vendor, made when it is saved; bundles sent to it sit there. */
export function VendorsView() {
  const { t } = useT();
  const fmt = useFmt();
  const cost = useSeesCost();
  const q = useVendors(true);
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);

  const columns: ResponsiveListColumn<Vendor>[] = [
    {
      key: "code",
      header: t("jw.col.code"),
      cell: (v) => (
        <button type="button" className="font-mono font-semibold whitespace-nowrap underline-offset-4 hover:underline" onClick={() => setEditing(v)} data-testid={`edit-vendor-${v.code}`}>
          {v.code}
        </button>
      ),
    },
    { key: "name", header: t("jw.col.name"), cell: (v) => v.name },
    { key: "gstin", header: t("jw.col.gstin"), hideOnPhone: true, cell: (v) => v.gstin ?? null, hideWhenEmpty: true },
    { key: "processes", header: t("jw.col.processes"), hideOnPhone: true, cell: (v) => (v.processes.length ? v.processes.map((p) => t(`jw.process.${processWord(p)}`)).join(", ") : null), hideWhenEmpty: true },
    ...(cost
      ? [
          {
            key: "rate",
            header: t("jw.col.rate"),
            align: "end" as const,
            hideOnPhone: true,
            hideWhenEmpty: true,
            cell: (v: Vendor) => (v.ratePaisePerKg ? t("jw.rate.perKg", { rate: rateText(fmt, v.ratePaisePerKg) }) : null),
          },
        ]
      : []),
    { key: "out", header: t("jw.col.out"), align: "end", cell: (v) => (v.outBundles > 0 ? t("jw.vendor.out", { bundles: v.outBundles, weight: kgWithUnit(fmt, v.outG) }) : null), hideWhenEmpty: true },
    {
      key: "active",
      header: t("jw.col.status"),
      phoneWide: true,
      cell: (v) => (
        <Chip tone={v.active ? "green" : "neutral"} truncate={false}>
          {v.active ? t("jw.vendor.active") : t("jw.vendor.inactive")}
        </Chip>
      ),
    },
  ];

  if (showsQueryError(q)) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("jw.loadFailed")}
          action={
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setEditing("new")} data-testid="add-vendor">
          <Plus aria-hidden="true" className="size-4" />
          {t("jw.action.addVendor")}
        </Button>
      </div>
      <ResponsiveList
        label={t("jw.tabs.vendors")}
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(v) => v.id}
        loading={q.isLoading}
        empty={<EmptyState title={t("jw.vendor.empty")} body={t("jw.vendor.emptyBody")} />}
      />
      <VendorSheet vendor={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function VendorSheet({ vendor, onClose }: { vendor: Vendor | "new" | null; onClose(): void }) {
  const { t } = useT();
  const cost = useSeesCost();
  const invalidate = useJobworkInvalidate();
  const open = vendor !== null;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (vendor === null) return;
    setTried(false);
    setDraft(vendor === "new" ? EMPTY : draftOf(vendor));
  }, [vendor]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const code = draft.code.trim().toUpperCase();
  const codeBad = !/^[A-Z0-9-]{1,12}$/.test(code);
  const nameBad = draft.name.trim() === "";
  const rateBad = cost && draft.rate.trim() !== "" && (paiseOf(draft.rate) === null || paiseOf(draft.rate)! > MAX_PAISE);

  const save = useOnceMutation(
    trpc.process.vendors.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("jw.vendor.saved", { code }));
        await invalidate();
        onClose();
      },
    }),
  );
  const existing = vendor && vendor !== "new" ? vendor : null;
  return (
    <FormSheet
      open={open}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={existing ? t("jw.vendor.editTitle", { code: existing.code }) : t("jw.vendor.newTitle")}
      description={t("jw.vendor.sheetHint")}
      busy={save.isPending}
      error={save.error}
      submitLabel={t("common.save")}
      testId="vendor-form"
      onSubmit={() => {
        setTried(true);
        if (codeBad || nameBad || rateBad) return;
        save.mutate({
          ...(existing ? { id: existing.id } : {}),
          code,
          name: draft.name.trim(),
          gstin: draft.gstin.trim() || null,
          address: draft.address.trim() || null,
          state: draft.state.trim() || null,
          phone: draft.phone.trim() || null,
          processes: draft.processes as (typeof finishProcesses)[number][],
          // The rate box is there only for people who see money (every holder of jobwork.masters does), so nothing is sent without it.
          ...(cost ? { ratePaisePerKg: paiseOf(draft.rate) } : {}),
          ...(existing ? { active: draft.active } : {}),
          note: draft.note.trim() || null,
        });
      }}
    >
      <Field label={t("jw.field.vendorCode")} hint={t("jw.field.vendorCodeHint")} error={tried && codeBad ? t("jw.error.vendorCode") : undefined} required>
        <TextInput value={draft.code} maxLength={12} autoCapitalize="characters" onChange={(e) => set({ code: e.currentTarget.value })} data-testid="vendor-code" />
      </Field>
      <Field label={t("jw.field.vendorName")} error={tried && nameBad ? t("jw.error.vendorName") : undefined} required>
        <TextInput value={draft.name} maxLength={120} onChange={(e) => set({ name: e.currentTarget.value })} data-testid="vendor-name" />
      </Field>
      <Field label={t("jw.field.gstin")}>
        <TextInput value={draft.gstin} maxLength={15} autoCapitalize="characters" onChange={(e) => set({ gstin: e.currentTarget.value })} data-testid="vendor-gstin" />
      </Field>
      <Field label={t("jw.field.address")}>
        <TextInput value={draft.address} maxLength={300} onChange={(e) => set({ address: e.currentTarget.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("jw.field.state")}>
          <TextInput value={draft.state} maxLength={60} onChange={(e) => set({ state: e.currentTarget.value })} />
        </Field>
        <Field label={t("jw.field.phone")}>
          <TextInput value={draft.phone} maxLength={30} inputMode="tel" onChange={(e) => set({ phone: e.currentTarget.value })} />
        </Field>
      </div>
      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
        <legend className="mb-1 p-0 text-[14px] font-semibold">{t("jw.field.vendorProcesses")}</legend>
        {finishProcesses.map((p) => (
          <label key={p} className="flex min-h-11 items-center gap-3 text-[15px]">
            <Checkbox
              checked={draft.processes.includes(p)}
              onCheckedChange={() => set({ processes: finishProcesses.filter((x) => (x === p ? !draft.processes.includes(p) : draft.processes.includes(x))) })}
              aria-label={t(`jw.process.${p}`)}
            />
            <span>{t(`jw.process.${p}`)}</span>
          </label>
        ))}
      </fieldset>
      {cost ? (
        <Field label={t("jw.rate.vendorRate")} hint={t("jw.rate.vendorRateHint")} error={tried && rateBad ? t("jw.rate.error") : undefined}>
          <NumberInput value={draft.rate} suffix="₹" onValueChange={(rate) => set({ rate })} data-testid="vendor-rate" />
        </Field>
      ) : null}
      {existing ? (
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <Checkbox checked={draft.active} onCheckedChange={(c) => set({ active: c === true })} aria-label={t("jw.vendor.active")} />
          <span>{t("jw.vendor.active")}</span>
        </label>
      ) : null}
      <Field label={t("jw.field.note")}>
        <TextInput value={draft.note} maxLength={500} onChange={(e) => set({ note: e.currentTarget.value })} />
      </Field>
    </FormSheet>
  );
}
