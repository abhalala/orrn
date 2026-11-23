/** Add or change a person: every field of the register in one sheet. PAN, Aadhaar and the account number are typed and kept apart. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MasterPicker } from "@/shared/components/master-picker";
import { trpc } from "@/shared/utils/trpc";

import { emptyPerson, formFromPerson, personInput, personProblems, type PersonCard, type PersonForm, type PersonProblem } from "./model";
import { Pick, errorText, usePlantShifts, useToday } from "./ui";

const KINDS = ["permanent", "contract", "apprentice", "casual"] as const;
const DOWS = [0, 1, 2, 3, 4, 5, 6] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The person to change; none adds a new one. */
  person?: PersonCard | null;
  onSaved?: (id: string) => void;
};

export function PersonSheet({ open, onOpenChange, person, onSaved }: Props) {
  const { t } = useT();
  const qc = useQueryClient();
  const today = useToday();
  const shifts = usePlantShifts();
  const [form, setForm] = useState<PersonForm>(() => emptyPerson(today));
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(person ? formFromPerson(person) : emptyPerson(today));
    setTried(false);
    // The form restarts each time the sheet opens, not when the clock ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, person?.id]);

  const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => setForm((p) => ({ ...p, [k]: v }));
  const problems = new Set<PersonProblem>(personProblems(form));
  const err = (p: PersonProblem) => (tried && problems.has(p) ? t(`hr.person.problem.${p}`) : undefined);

  const onDone = async (id: string) => {
    await qc.invalidateQueries({ queryKey: trpc.hr.people.pathKey() });
    toast.success(t("hr.person.saved"));
    onOpenChange(false);
    onSaved?.(id);
  };
  const create = useMutation({ ...trpc.hr.people.create.mutationOptions(), onSuccess: (r) => void onDone(r.id), onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))) });
  const update = useMutation({ ...trpc.hr.people.update.mutationOptions(), onSuccess: (r) => void onDone(r.id), onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))) });
  const pending = create.isPending || update.isPending;

  function submit() {
    setTried(true);
    if (problems.size > 0) return;
    const input = personInput(form);
    if (person) update.mutate({ ...input, id: person.id });
    else create.mutate(input);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={person ? t("hr.person.editTitle") : t("hr.person.addTitle")}
      description={t("hr.person.hint")}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={pending} onClick={submit}>
            {t("hr.person.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.person.code")} required error={err("code")} hint={t("hr.person.codeHint")}>
            <TextInput value={form.code} onChangeText={(v) => set("code", v.toUpperCase())} maxLength={16} />
          </Field>
          <Field label={t("hr.person.kind")}>
            <Pick value={form.kind} onChange={(v) => set("kind", v as PersonForm["kind"])} options={KINDS.map((k) => ({ value: k, label: t(`hr.kind.${k}`) }))} />
          </Field>
        </div>
        <Field label={t("hr.person.name")} required error={err("name")}>
          <TextInput value={form.name} onChangeText={(v) => set("name", v)} maxLength={80} />
        </Field>
        {form.kind === "contract" ? (
          <Field label={t("hr.person.contractor")} required error={err("contractor")}>
            <TextInput value={form.contractorName} onChangeText={(v) => set("contractorName", v)} maxLength={80} />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.person.department")}>
            <MasterPicker kind="department" value={form.departmentId || null} onChange={(id) => set("departmentId", id ?? "")} />
          </Field>
          <Field label={t("hr.person.designation")}>
            <MasterPicker kind="designation" value={form.designationId || null} onChange={(id) => set("designationId", id ?? "")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.person.joinedOn")} required error={err("joinedOn")}>
            <TextInput type="date" value={form.joinedOn} onChangeText={(v) => set("joinedOn", v)} />
          </Field>
          <Field label={t("hr.person.dob")} error={err("dob")} hint={t("hr.person.dobHint")}>
            <TextInput type="date" value={form.dob} onChangeText={(v) => set("dob", v)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.person.phone")} error={err("phone")}>
            <TextInput type="tel" value={form.phone} onChangeText={(v) => set("phone", v)} maxLength={16} />
          </Field>
          <Field label={t("hr.person.deviceCode")} hint={t("hr.person.deviceCodeHint")}>
            <TextInput value={form.deviceCode} onChangeText={(v) => set("deviceCode", v)} maxLength={32} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.person.shift")}>
            <Pick value={form.shiftId} onChange={(v) => set("shiftId", v)} options={[{ value: "", label: t("hr.person.shiftNone") }, ...shifts.map((s) => ({ value: s.id, label: s.name }))]} />
          </Field>
          <Field label={t("hr.person.weeklyOff")}>
            <Pick value={form.weeklyOffDow} onChange={(v) => set("weeklyOffDow", v)} options={[{ value: "", label: t("hr.person.weeklyOffPlant") }, ...DOWS.map((d) => ({ value: String(d), label: t(`hr.dow.d${d}`) }))]} />
          </Field>
        </div>

        <h3 className="m-0 mt-2 text-[14px] font-semibold">{t("hr.person.bankTitle")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.person.bankName")}>
            <TextInput value={form.bankName} onChangeText={(v) => set("bankName", v)} maxLength={60} />
          </Field>
          <Field label={t("hr.person.ifsc")} error={err("ifsc")}>
            <TextInput value={form.bankIfsc} onChangeText={(v) => set("bankIfsc", v.toUpperCase())} maxLength={11} />
          </Field>
        </div>
        <Field label={t("hr.person.account")} error={err("account")} hint={person?.bankAccountMasked ? t("hr.person.accountKept", { masked: person.bankAccountMasked }) : t("hr.person.accountHint")}>
          <TextInput inputMode="numeric" value={form.bankAccountNo} onChangeText={(v) => set("bankAccountNo", v)} maxLength={24} autoComplete="off" />
        </Field>

        <h3 className="m-0 mt-2 text-[14px] font-semibold">{t("hr.person.idsTitle")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.person.pan")} hint={person?.panLast4 ? t("hr.person.lastFourKept", { last4: person.panLast4 }) : t("hr.person.lastFourOnly")}>
            <TextInput value={form.pan} onChangeText={(v) => set("pan", v.toUpperCase())} maxLength={10} autoComplete="off" />
          </Field>
          <Field label={t("hr.person.aadhaar")} hint={person?.aadhaarLast4 ? t("hr.person.lastFourKept", { last4: person.aadhaarLast4 }) : t("hr.person.lastFourOnly")}>
            <TextInput inputMode="numeric" value={form.aadhaar} onChangeText={(v) => set("aadhaar", v)} maxLength={14} autoComplete="off" />
          </Field>
          <Field label={t("hr.person.uan")} error={err("uan")}>
            <TextInput inputMode="numeric" value={form.uan} onChangeText={(v) => set("uan", v)} maxLength={12} />
          </Field>
          <Field label={t("hr.person.esic")} error={err("esic")}>
            <TextInput inputMode="numeric" value={form.esicIp} onChangeText={(v) => set("esicIp", v)} maxLength={10} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
