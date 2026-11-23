import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { FieldSelect } from "@/features/orders/components/controls";
import { CustomerField, DieField } from "@/features/orders/components/pickers";
import { serverRefusalLines } from "@/features/shared/server-refusal";
import { Can } from "@/shared/components/can";
import { PlantInput } from "@/shared/components/plant-input";
import { MASS_KG } from "@/shared/lib/plant-input";
import { trpcClient } from "@/shared/utils/trpc";

import { blankEnquiry, draftFromEnquiry, ENQUIRY_STATUS_LIST, enquiryProblems, toEnquiryCreate, toEnquiryUpdate, type EnquiryDraft, type EnquiryRow, type EnquiryStatusValue } from "./enquiry-model";
import { FormErrors } from "./form-errors";
import { useInvalidateDocs } from "./use-docs";

/** Add or change an enquiry (`enquiry.manage`): the customer or a prospect's name, contact, the section, kg, the next follow-up and the note. */
export function EnquirySheet({ open, onOpenChange, row }: { open: boolean; onOpenChange(open: boolean): void; row?: EnquiryRow }) {
  const { t } = useT();
  const invalidate = useInvalidateDocs();
  const formId = `enquiry-form-${useId().replace(/:/g, "")}`;
  const [d, setD] = useState<EnquiryDraft>(blankEnquiry);
  const [tried, setTried] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const patch = (p: Partial<EnquiryDraft>) => setD((cur) => ({ ...cur, ...p }));

  useEffect(() => {
    if (!open) return;
    setD(row ? draftFromEnquiry(row) : blankEnquiry());
    setTried(false);
    setErrors([]);
  }, [open, row?.id, row?.serverSeq]);

  const save = useMutation({
    mutationFn: async (): Promise<{ id: string }> => (row ? trpcClient.pricing.enquiries.update.mutate(toEnquiryUpdate(d, row.id, row.serverSeq)) : trpcClient.pricing.enquiries.create.mutate(toEnquiryCreate(d))),
    onSuccess: async () => {
      toast.success(t(row ? "price.enquiries.saved" : "price.enquiries.added"));
      await Promise.all([invalidate.enquiries(), invalidate.today()]);
      onOpenChange(false);
    },
    onError: (e) => setErrors(serverRefusalLines(t, e)),
  });

  const problems = enquiryProblems(d);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    setTried(true);
    setErrors([]);
    if (Object.keys(problems).length === 0) save.mutate();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("price.enquiries.form.editTitle") : t("price.enquiries.form.addTitle")}
      description={t("price.enquiries.form.hint")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Can do="enquiry.manage">
            <Button type="submit" form={formId} size="lg" loading={save.isPending}>
              {t("price.enquiries.form.save")}
            </Button>
          </Can>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-5 pt-1">
      <CustomerField value={d.customer} onChange={(customer) => patch({ customer })} error={tried && problems.party ? t(problems.party) : undefined} />
      {d.customer ? (
        <div>
          <Button variant="ghost" onClick={() => patch({ customer: null })}>
            {t("price.enquiries.form.clearCustomer")}
          </Button>
        </div>
      ) : (
        <Field label={t("price.enquiries.form.prospect")} hint={t("price.enquiries.form.prospectHint")}>
          <TextInput value={d.prospectName} onChangeText={(prospectName) => patch({ prospectName })} maxLength={120} autoComplete="off" />
        </Field>
      )}
      <Field label={t("price.enquiries.form.contact")}>
        <TextInput value={d.contact} onChangeText={(contact) => patch({ contact })} maxLength={120} autoComplete="off" />
      </Field>
      <DieField value={d.section} onChange={(section) => patch({ section })} />
      {d.section ? (
        <div>
          <Button variant="ghost" onClick={() => patch({ section: null })}>
            {t("price.enquiries.form.clearSection")}
          </Button>
        </div>
      ) : (
        <Field label={t("price.enquiries.form.sectionText")} hint={t("price.enquiries.form.sectionTextHint")}>
          <TextInput value={d.sectionText} onChangeText={(sectionText) => patch({ sectionText })} maxLength={120} autoComplete="off" />
        </Field>
      )}
      <Field label={t("orders.line.kg")} error={tried && problems.kg ? t(problems.kg) : undefined}>
        <PlantInput spec={MASS_KG} value={d.kgText} onValueChange={(kgText) => patch({ kgText })} aria-label={t("orders.line.kg")} />
      </Field>
      <Field label={t("price.enquiries.form.followUp")}>
        <TextInput type="date" value={d.followUpDate} onChangeText={(followUpDate) => patch({ followUpDate })} />
      </Field>
      {row ? (
        <Field label={t("price.enquiries.form.status")}>
          <FieldSelect value={d.status} onChange={(e) => patch({ status: e.target.value as EnquiryStatusValue })}>
            {ENQUIRY_STATUS_LIST.map((s) => (
              <option key={s} value={s}>
                {t(`price.enquiries.status.${s}`)}
              </option>
            ))}
          </FieldSelect>
        </Field>
      ) : null}
      <Field label={t("common.note")}>
        <FieldTextArea value={d.note} onChangeText={(note) => patch({ note })} rows={3} maxLength={1000} />
      </Field>
      <FormErrors lines={errors} />
      </form>
    </Sheet>
  );
}
