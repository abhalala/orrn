/** The plant's HSN list: seed the aluminium codes, add or edit one, pick the default, and give sections their HSN. */
import { GST_UQC } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { dieTitle } from "@/features/orders/view";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { bpToPercent, percentToBp } from "./model";
import { errorText } from "./ui";

type Hsn = { id: string; code: string; description: string; rateBp: number; uqc: (typeof GST_UQC)[number]; isDefault: boolean; active: boolean; sections: number };

export function HsnSection() {
  const { t } = useT();
  const qc = useQueryClient();
  const list = useQuery(trpc.billing.hsn.list.queryOptions());
  const [editing, setEditing] = useState<Hsn | "new" | null>(null);
  const [assigning, setAssigning] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.billing.hsn.pathKey() });

  const seed = useMutation({
    ...trpc.billing.hsn.seedDefaults.mutationOptions(),
    onSuccess: async (r) => {
      await refresh();
      toast.success(r.added > 0 ? t("bill.hsn.seeded", { count: r.added }) : t("bill.hsn.seedNone"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  const rows = (list.data ?? []) as Hsn[];
  return (
    <section aria-labelledby="bill-hsn" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="bill-hsn" className="m-0 text-[15px] font-semibold">
            {t("bill.hsn.title")}
          </h2>
          <p className="m-0 text-[13px] text-muted-foreground">{t("bill.hsn.hint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={seed.isPending} onClick={() => seed.mutate()}>
            {t("bill.hsn.seed")}
          </Button>
          <Button variant="secondary" disabled={rows.length === 0} onClick={() => setAssigning(true)}>
            {t("bill.hsn.assign")}
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("bill.hsn.add")}
          </Button>
        </div>
      </div>
      {list.isError ? (
        <Button variant="secondary" onClick={() => void list.refetch()}>
          {t("common.retry")}
        </Button>
      ) : rows.length === 0 && !list.isPending ? (
        <EmptyState title={t("bill.hsn.empty")} body={t("bill.hsn.emptyHint")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">{t("bill.doc.hsn")}</th>
                <th className="py-1.5 pr-2 font-medium">{t("bill.doc.description")}</th>
                <th className="py-1.5 pr-2 text-right font-medium">{t("bill.hsn.rate")}</th>
                <th className="py-1.5 pr-2 text-right font-medium">{t("bill.hsn.sections")}</th>
                <th className="py-1.5 pr-2 font-medium">{t("bill.list.status")}</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} className="border-b border-border/60">
                  <td className="py-1.5 pr-2 font-mono font-semibold">{h.code}</td>
                  <td className="py-1.5 pr-2">{h.description}</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{bpToPercent(h.rateBp)}%</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{h.sections}</td>
                  <td className="py-1.5 pr-2">
                    <span className="flex flex-wrap gap-1.5">
                      {h.isDefault ? <Chip tone="blue">{t("bill.hsn.default")}</Chip> : null}
                      {!h.active ? <Chip tone="neutral">{t("bill.hsn.inactive")}</Chip> : null}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(h)}>
                      {t("common.edit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <HsnSheet value={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <AssignSheet open={assigning} onOpenChange={setAssigning} hsn={rows.filter((h) => h.active)} onSaved={refresh} />
    </section>
  );
}

function HsnSheet({ value, onClose, onSaved }: { value: Hsn | "new" | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const { t } = useT();
  const open = value !== null;
  const cur = value && value !== "new" ? value : null;
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [rate, setRate] = useState("18");
  const [uqc, setUqc] = useState<(typeof GST_UQC)[number]>("KGS");
  const [isDefault, setIsDefault] = useState(false);
  const [active, setActive] = useState(true);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(cur?.code ?? "");
    setDescription(cur?.description ?? "");
    setRate(cur ? bpToPercent(cur.rateBp) : "18");
    setUqc(cur?.uqc ?? "KGS");
    setIsDefault(cur?.isDefault ?? false);
    setActive(cur?.active ?? true);
    setTried(false);
  }, [open, cur]);

  const save = useMutation({
    ...trpc.billing.hsn.save.mutationOptions(),
    onSuccess: async () => {
      await onSaved();
      toast.success(t("bill.hsn.saved"));
      onClose();
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });
  const bp = percentToBp(rate);
  const codeOk = /^\d{4}$|^\d{6}$|^\d{8}$/.test(code.trim());
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={cur ? t("bill.hsn.edit") : t("bill.hsn.add")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (!codeOk || bp === null || !description.trim() || (isDefault && !active)) return;
              save.mutate({ id: cur?.id ?? null, code: code.trim(), description: description.trim(), rateBp: bp, uqc, isDefault, active });
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("bill.doc.hsn")} hint={t("bill.hsn.codeHint")} error={tried && !codeOk ? t("bill.hsn.codeBad") : undefined}>
          <TextInput value={code} onChangeText={setCode} inputMode="numeric" maxLength={8} />
        </Field>
        <Field label={t("bill.doc.description")} error={tried && !description.trim() ? t("bill.hsn.descriptionBad") : undefined}>
          <TextInput value={description} onChangeText={setDescription} maxLength={120} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("bill.hsn.rate")} error={tried && bp === null ? t("bill.hsn.rateBad") : undefined}>
            <NumberInput value={rate} onValueChange={setRate} suffix="%" />
          </Field>
          <Field label={t("bill.hsn.unit")}>
            <Select value={uqc} onValueChange={(v) => setUqc(v as (typeof GST_UQC)[number])} options={GST_UQC.map((u) => ({ value: u, label: u }))} placeholder={t("bill.hsn.unit")} />
          </Field>
        </div>
        <label className="flex items-center gap-3 text-[14px]">
          <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} />
          {t("bill.hsn.makeDefault")}
        </label>
        <label className="flex items-center gap-3 text-[14px]">
          <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
          {t("bill.hsn.active")}
        </label>
        {tried && isDefault && !active ? <p role="alert" className="m-0 text-[13px] text-destructive">{t("bill.hsn.defaultActive")}</p> : null}
      </div>
    </Sheet>
  );
}

const DEFAULT_PICK = "default";

function AssignSheet({ open, onOpenChange, hsn, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; hsn: Hsn[]; onSaved: () => Promise<unknown> }) {
  const { t } = useT();
  const [target, setTarget] = useState<string>(hsn[0]?.id ?? DEFAULT_PICK);
  const [dies, setDies] = useState<{ id: string; label: string }[]>([]);
  const labels = useRef(new Map<string, string>());

  useEffect(() => {
    if (open) {
      setDies([]);
      setTarget(hsn.find((h) => h.isDefault)?.id ?? hsn[0]?.id ?? DEFAULT_PICK);
    }
    // the list is read once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useMutation({
    ...trpc.billing.hsn.assign.mutationOptions(),
    onSuccess: async () => {
      await onSaved();
      toast.success(t("bill.hsn.assigned", { count: dies.length }));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("bill.hsn.assign")}
      description={t("bill.hsn.assignHint")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={save.isPending} disabled={dies.length === 0} onClick={() => save.mutate({ dieIds: dies.map((d) => d.id), hsnId: target === DEFAULT_PICK ? null : target })}>
            {t("bill.hsn.assignSave")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("bill.hsn.assignTo")}>
          <Select value={target} onValueChange={setTarget} options={[{ value: DEFAULT_PICK, label: t("bill.hsn.backToDefault") }, ...hsn.map((h) => ({ value: h.id, label: `${h.code} ${h.description}` }))]} placeholder={t("bill.hsn.assignTo")} />
        </Field>
        <Field label={t("bill.hsn.pickSections")}>
          <Combobox<string>
            value={null}
            onChange={(id) => setDies((p) => (p.some((d) => d.id === id) || p.length >= 40 ? p : [...p, { id, label: labels.current.get(id) ?? id }]))}
            search={async (q) => {
              const res = await trpcClient.die.list.query({ search: q, limit: 20 });
              return res.items.map((d) => {
                const label = dieTitle({ sectionCode: d.sectionCode, name: d.name, series: d.series });
                labels.current.set(d.id, label);
                return { value: d.id, label } satisfies ComboboxOption<string>;
              });
            }}
            placeholder={t("orders.form.dieSearch")}
          />
        </Field>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {dies.map((d) => (
            <li key={d.id} className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-3 text-[13px]">
              {d.label}
              <button type="button" aria-label={t("common.remove")} className="rounded-full p-1" onClick={() => setDies((p) => p.filter((x) => x.id !== d.id))}>
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
