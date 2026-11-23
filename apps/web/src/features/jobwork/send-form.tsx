import { finishProcesses } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { StickyBar } from "@/shared/components/sticky-bar";
import { rateText } from "@/shared/lib/fmt-text";
import { useFmt } from "@/shared/lib/fmt";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { useJobworkInvalidate, useSeesCost, useToday, useVendors } from "./hooks";
import { sendPayload, sendProblems, type SendDraft } from "./model";
import { BundlePicker } from "./picker";
import { FieldSelect, Panel, RefusalNote } from "./ui";

const EMPTY: SendDraft = { vendorId: "", process: "anodise", finishCode: "", expectedReturn: "", vehicleNo: "", valueDraft: "", note: "", picks: [] };

/**
 * A new job-work challan (row 33): vendor, process, the bundles (scanned, typed or picked), the date it should be back,
 * the vehicle and, for people who see money, the declared value per kg. Saving moves the bundles to the vendor's place and
 * holds them; the challan number is JW/year/n and the A4 paper is one tap away.
 */
export function SendForm() {
  const { t } = useT();
  const fmt = useFmt();
  const navigate = useNavigate();
  const invalidate = useJobworkInvalidate();
  const seesCost = useSeesCost();
  const today = useToday();
  const vendors = useVendors();
  const [draft, setDraft] = useState<SendDraft>(EMPTY);
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<SendDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const active = vendors.data?.items ?? [];
  const vendor = active.find((v) => v.id === draft.vendorId) ?? null;
  const problems = sendProblems(draft, today);
  const shown = (p: (typeof problems)[number]) => tried && problems.includes(p);

  const send = useOnceMutation(
    trpc.process.steps.send.mutationOptions({
      onSuccess: async (res) => {
        toast.success(t("jw.send.sent", { number: res.number }));
        await invalidate();
        void navigate({ to: "/jobwork/$id/challan", params: { id: res.id } });
      },
    }),
  );

  // The vendor's usual process and rate lead: picking a vendor that does one process selects it.
  const pickVendor = (vendorId: string) => {
    const v = active.find((x) => x.id === vendorId);
    const only = v && v.processes.length === 1 ? v.processes[0]! : null;
    set({ vendorId, ...(only ? { process: only } : {}) });
  };

  if (vendors.data && active.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card" data-testid="no-vendors">
        <EmptyState
          title={t("jw.send.noVendors")}
          body={t("jw.send.noVendorsBody")}
          action={
            <Can do="jobwork.masters">
              <Button asChild>
                <UiLink to="/jobwork" className="no-underline">
                  {t("jw.tabs.vendors")}
                </UiLink>
              </Button>
            </Can>
          }
        />
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-5"
      data-testid="send-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (problems.length > 0 || send.isPending) return;
        send.mutate(sendPayload(draft, seesCost));
      }}
    >
      <Panel className="flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("jw.field.vendor")} error={shown("vendor") ? t("jw.error.vendor") : undefined} required>
            <FieldSelect value={draft.vendorId} onChange={(e) => pickVendor(e.currentTarget.value)} data-testid="send-vendor">
              <option value="">{t("jw.field.pickVendor")}</option>
              {active.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} · {v.name}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label={t("jw.field.process")} error={shown("process") ? t("jw.error.process") : undefined} required>
            <FieldSelect value={draft.process} onChange={(e) => set({ process: e.currentTarget.value })} data-testid="send-process">
              {finishProcesses.map((p) => (
                <option key={p} value={p}>
                  {t(`jw.process.${p}`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label={t("jw.field.finishCode")} hint={t("jw.field.finishCodeHint")}>
            <TextInput value={draft.finishCode} maxLength={40} onChange={(e) => set({ finishCode: e.currentTarget.value })} data-testid="send-finish-code" />
          </Field>
          <Field label={t("jw.field.expectedReturn")} hint={t("jw.field.expectedReturnHint")} error={shown("date") ? t("jw.error.date") : undefined}>
            <TextInput type="date" value={draft.expectedReturn} min={today} onChange={(e) => set({ expectedReturn: e.currentTarget.value })} data-testid="send-expected" />
          </Field>
          <Field label={t("jw.field.vehicleNo")}>
            <TextInput value={draft.vehicleNo} maxLength={20} autoCapitalize="characters" onChange={(e) => set({ vehicleNo: e.currentTarget.value })} data-testid="send-vehicle" />
          </Field>
          {seesCost ? (
            <Field
              label={t("jw.rate.valuePerKg")}
              hint={vendor?.ratePaisePerKg ? t("jw.rate.valueHint", { rate: rateText(fmt, vendor.ratePaisePerKg) }) : t("jw.rate.valueHintPlain")}
              error={shown("value") ? t("jw.error.value") : undefined}
            >
              <NumberInput value={draft.valueDraft} suffix="₹" onValueChange={(valueDraft) => set({ valueDraft })} data-testid="send-value" />
            </Field>
          ) : null}
        </div>
        <Field label={t("jw.field.note")}>
          <TextInput value={draft.note} maxLength={500} onChange={(e) => set({ note: e.currentTarget.value })} data-testid="send-note" />
        </Field>
      </Panel>
      <Panel>
        <BundlePicker picks={draft.picks} onChange={(picks) => set({ picks })} error={shown("bundles") ? t("jw.error.bundles") : shown("tooMany") ? t("jw.error.tooMany") : undefined} />
      </Panel>
      <RefusalNote error={send.error} />
      <StickyBar className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button asChild variant="secondary" size="lg">
          <UiLink to="/jobwork" className="no-underline">
            {t("common.cancel")}
          </UiLink>
        </Button>
        <Button type="submit" size="lg" loading={send.isPending} data-testid="send-submit">
          {t("jw.action.send")}
        </Button>
      </StickyBar>
    </form>
  );
}
