import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { kgFromG } from "@/features/press/model";

import {
  CHEMICAL_UNITS,
  figuresOf,
  kgToG,
  lineKey,
  LDO_KEYS,
  MAX_CHEMICALS,
  MAX_LOG_LINES,
  MAX_LOT_LINES,
  MAX_STREAM_RETURNS,
  qtyToMilli,
  type FormIssue,
  type LdoKey,
  type MeltForm,
} from "./melt-form";
import { MELT_TIME_KEYS, nowTimeIn, resolveMeltTimes } from "./melt-times";
import { bpText } from "./model";
import { Note, FieldSelect } from "./ui";

export type Lot = { id: string; number: string; itemName: string; gradeCode: string; remainingG: number };
export type Stream = { id: string; code: string; name: string; kind: string; active: boolean; balanceG: number };
export type StoreItem = { id: string; name: string; unit: string; active: boolean };
export type FurnaceOpt = { id: string; code: string; name: string; capacityG: number; status: string };
export type AlloyOpt = { id: string; code: string; status: string };

export type StepProps = {
  form: MeltForm;
  patch(next: Partial<MeltForm>): void;
  /** The first problem the last save attempt found, to mark its line. */
  issue: FormIssue | null;
  readOnly?: boolean;
};

const LINE = "flex min-w-0 flex-col gap-3 rounded-card border border-border p-3 sm:flex-row sm:items-end";

function RemoveButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <Button type="button" variant="ghost" size="sm" aria-label={label} onClick={onClick} className="self-end">
      <Trash2 aria-hidden="true" strokeWidth={2} />
    </Button>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="m-0 text-[16px] font-semibold">{children}</h3>;
}

// --- 1. Furnace, alloy and times -------------------------------------------------------------------------------

const TIME_LABEL = {
  preheatStart: "foundry.melt.times.preheatStart",
  chargingStart: "foundry.melt.times.chargingStart",
  chargingEnd: "foundry.melt.times.chargingEnd",
  castingStart: "foundry.melt.times.castingStart",
  castingEnd: "foundry.melt.times.castingEnd",
} as const;

export function TimesStep({ form, patch, issue, furnaces, alloys, castAlloy, timeZone }: StepProps & { furnaces: FurnaceOpt[]; alloys: AlloyOpt[]; castAlloy: string; timeZone: string }) {
  const { t } = useT();
  const resolved = resolveMeltTimes(form.date, form.times, timeZone);
  const picked = alloys.find((a) => a.id === form.alloyId);
  const differs = picked !== undefined && picked.code !== castAlloy;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("foundry.melt.furnace")} hint={furnaces.length === 0 ? t("foundry.melt.noFurnace") : undefined}>
          <FieldSelect value={form.furnaceId} onChange={(e) => patch({ furnaceId: e.currentTarget.value })} data-testid="melt-furnace">
            <option value="">{t("foundry.melt.furnacePick")}</option>
            {furnaces.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} · {kgFromG(f.capacityG)} {t("units.kg")}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("foundry.melt.alloy")}>
          <FieldSelect value={form.alloyId} onChange={(e) => patch({ alloyId: e.currentTarget.value })} data-testid="melt-alloy">
            <option value="">{t("foundry.melt.alloyAsCast", { alloy: castAlloy })}</option>
            {alloys.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code}
              </option>
            ))}
          </FieldSelect>
        </Field>
      </div>
      {differs ? (
        <Field label={t("foundry.melt.alloyReason")} hint={t("foundry.melt.alloyReasonHint", { cast: castAlloy })}>
          <FieldTextArea value={form.alloyReason} maxLength={500} onChange={(e) => patch({ alloyReason: e.currentTarget.value })} data-testid="melt-alloy-reason" />
        </Field>
      ) : null}
      <Field label={t("foundry.melt.date")} error={issue?.code === "date" ? t("foundry.melt.issue.date") : undefined}>
        <TextInput type="date" value={form.date} onChange={(e) => patch({ date: e.currentTarget.value })} data-testid="melt-date" className="max-w-[14rem]" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MELT_TIME_KEYS.map((k) => (
          <div key={k} className="flex min-w-0 items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field
                label={t(TIME_LABEL[k])}
                hint={resolved.nextDay[k] ? t("foundry.melt.nextDay") : undefined}
                error={issue?.code === "time" && resolved.invalid.includes(k) ? t("foundry.melt.issue.time") : undefined}
              >
                <TextInput type="time" value={form.times[k]} onChange={(e) => patch({ times: { ...form.times, [k]: e.currentTarget.value } })} data-testid={`melt-time-${k}`} />
              </Field>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => patch({ times: { ...form.times, [k]: nowTimeIn(timeZone) } })} data-testid={`melt-now-${k}`}>
              {t("foundry.melt.now")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 2. Charge -----------------------------------------------------------------------------------------------

export function ChargeStep({ form, patch, issue, lots, streams, capacityG }: StepProps & { lots: Lot[]; streams: Stream[]; capacityG: number | null }) {
  const { t } = useT();
  const fig = figuresOf(form, capacityG);
  const takenLots = new Set(form.lots.map((l) => l.lotId));
  const takenStreams = new Set(form.streams.map((s) => s.streamId));
  const charge = streams.filter((s) => s.kind === "charge" && s.active);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="charge-lots">
        <SectionTitle>
          <span id="charge-lots">{t("foundry.melt.charge.lots")}</span>
        </SectionTitle>
        {lots.length === 0 ? <Note>{t("foundry.melt.charge.noLots")}</Note> : null}
        {form.lots.map((l, i) => {
          const lot = lots.find((x) => x.id === l.lotId);
          const g = kgToG(l.kgText);
          const over = lot !== undefined && g !== null && g > lot.remainingG;
          const marked = issue?.step === "charge" && issue.line === i && (issue.code === "lot" || issue.code === "kg" || issue.code === "kgTooLarge" || issue.code === "duplicateLot");
          return (
            <div key={l.key} className={LINE} data-testid="lot-line">
              <div className="min-w-0 flex-1">
                <Field label={t("foundry.melt.charge.lot")} error={marked && (issue!.code === "lot" || issue!.code === "duplicateLot") ? t(`foundry.melt.issue.${issue!.code}`) : undefined}>
                  <FieldSelect
                    value={l.lotId}
                    onChange={(e) => patch({ lots: form.lots.map((x) => (x.key === l.key ? { ...x, lotId: e.currentTarget.value } : x)) })}
                    data-testid="lot-pick"
                  >
                    <option value="">{t("foundry.melt.charge.lotPick")}</option>
                    {lots.map((x) => (
                      <option key={x.id} value={x.id} disabled={takenLots.has(x.id) && x.id !== l.lotId}>
                        {x.number} · {[x.itemName, x.gradeCode].filter(Boolean).join(" ")} · {kgFromG(x.remainingG)} {t("units.kg")}
                      </option>
                    ))}
                  </FieldSelect>
                </Field>
              </div>
              <div className="sm:w-44">
                <Field
                  label={t("foundry.melt.charge.kg")}
                  hint={lot ? t("foundry.melt.charge.left", { kg: kgFromG(lot.remainingG) }) : undefined}
                  error={over ? t("foundry.melt.charge.over", { kg: kgFromG(lot!.remainingG) }) : marked && (issue!.code === "kg" || issue!.code === "kgTooLarge") ? t(`foundry.melt.issue.${issue!.code}`) : undefined}
                >
                  <NumberInput value={l.kgText} suffix={t("units.kg")} onValueChange={(v) => patch({ lots: form.lots.map((x) => (x.key === l.key ? { ...x, kgText: v } : x)) })} data-testid="lot-kg" />
                </Field>
              </div>
              {lot ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => patch({ lots: form.lots.map((x) => (x.key === l.key ? { ...x, kgText: String(lot.remainingG / 1000) } : x)) })}>
                  {t("foundry.melt.charge.all")}
                </Button>
              ) : null}
              <RemoveButton label={t("common.remove")} onClick={() => patch({ lots: form.lots.filter((x) => x.key !== l.key) })} />
            </div>
          );
        })}
        <div>
          <Button type="button" variant="secondary" disabled={form.lots.length >= MAX_LOT_LINES || lots.length === 0} onClick={() => patch({ lots: [...form.lots, { key: lineKey(), lotId: "", kgText: "" }] })} data-testid="add-lot">
            <Plus aria-hidden="true" strokeWidth={2} /> {t("foundry.melt.charge.addLot")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="charge-streams">
        <SectionTitle>
          <span id="charge-streams">{t("foundry.melt.charge.streams")}</span>
        </SectionTitle>
        {form.streams.map((s, i) => {
          const stream = charge.find((x) => x.id === s.streamId);
          const marked = issue?.step === "charge" && issue.line === i && issue.code !== "lot" && issue.code !== "duplicateLot" && issue.code !== "tooMany";
          return (
            <div key={s.key} className={LINE} data-testid="stream-line">
              <div className="min-w-0 flex-1">
                <Field label={t("foundry.melt.charge.stream")}>
                  <FieldSelect value={s.streamId} onChange={(e) => patch({ streams: form.streams.map((x) => (x.key === s.key ? { ...x, streamId: e.currentTarget.value } : x)) })} data-testid="stream-pick">
                    <option value="">{t("foundry.melt.charge.streamPick")}</option>
                    {charge.map((x) => (
                      <option key={x.id} value={x.id} disabled={takenStreams.has(x.id) && x.id !== s.streamId}>
                        {x.code} · {kgFromG(x.balanceG)} {t("units.kg")}
                      </option>
                    ))}
                  </FieldSelect>
                </Field>
              </div>
              <div className="sm:w-44">
                <Field
                  label={t("foundry.melt.charge.kg")}
                  hint={stream ? t("foundry.melt.charge.left", { kg: kgFromG(stream.balanceG) }) : undefined}
                  error={marked ? t("foundry.melt.issue.kg") : undefined}
                >
                  <NumberInput value={s.kgText} suffix={t("units.kg")} onValueChange={(v) => patch({ streams: form.streams.map((x) => (x.key === s.key ? { ...x, kgText: v } : x)) })} data-testid="stream-kg" />
                </Field>
              </div>
              <RemoveButton label={t("common.remove")} onClick={() => patch({ streams: form.streams.filter((x) => x.key !== s.key) })} />
            </div>
          );
        })}
        <div>
          <Button type="button" variant="secondary" disabled={charge.length === 0} onClick={() => patch({ streams: [...form.streams, { key: lineKey(), streamId: "", kgText: "" }] })} data-testid="add-stream">
            <Plus aria-hidden="true" strokeWidth={2} /> {t("foundry.melt.charge.addStream")}
          </Button>
        </div>
      </section>

      <p className="m-0 text-[15px] font-semibold tabular-nums" data-testid="charge-total">
        {t("foundry.melt.charge.total", { kg: kgFromG(fig.balance.metalInG) })}
      </p>
      {fig.load === "over" ? <Note tone="red">{t("foundry.melt.charge.overCapacity")}</Note> : fig.load === "near" ? <Note tone="amber">{t("foundry.melt.charge.nearCapacity")}</Note> : null}
    </div>
  );
}

// --- 3. Chemicals and LDO ----------------------------------------------------------------------------------------

export function ChemicalsStep({ form, patch, issue, storeItems }: StepProps & { storeItems: StoreItem[] }) {
  const { t } = useT();
  const active = storeItems.filter((i) => i.active);
  const taken = new Set(form.chemicals.map((c) => c.storeItemId).filter(Boolean));
  const ldoUsed = (() => {
    const a = form.ldo.start.trim() === "" ? null : Number(form.ldo.start.replace(",", "."));
    const b = form.ldo.end.trim() === "" ? null : Number(form.ldo.end.replace(",", "."));
    return a === null || b === null || Number.isNaN(a) || Number.isNaN(b) || b > a ? null : Math.round((a - b) * 10) / 10;
  })();
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="chem-title">
        <SectionTitle>
          <span id="chem-title">{t("foundry.melt.chem.title")}</span>
        </SectionTitle>
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.melt.chem.hint")}</p>
        {form.chemicals.map((c, i) => {
          const other = c.storeItemId === "" && c.unit !== "";
          const open = qtyToMilli(c.openText);
          const used = qtyToMilli(c.usedText);
          const close = open !== null && used !== null ? open - used : null;
          const marked = issue?.step === "chemicals" && issue.line === i && issue.code !== "ldo";
          const set = (next: Partial<typeof c>) => patch({ chemicals: form.chemicals.map((x) => (x.key === c.key ? { ...x, ...next } : x)) });
          return (
            <div key={c.key} className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-3" data-testid="chem-line">
              <Field label={t("foundry.melt.chem.item")}>
                <FieldSelect value={other ? "__other" : c.storeItemId} onChange={(e) => set(e.currentTarget.value === "__other" ? { storeItemId: "", unit: c.unit || "kg" } : { storeItemId: e.currentTarget.value, name: "", unit: "" })} data-testid="chem-pick">
                  <option value="">{t("foundry.melt.chem.pick")}</option>
                  {active.map((x) => (
                    <option key={x.id} value={x.id} disabled={taken.has(x.id) && x.id !== c.storeItemId}>
                      {x.name} ({x.unit})
                    </option>
                  ))}
                  <option value="__other">{t("foundry.melt.chem.other")}</option>
                </FieldSelect>
              </Field>
              {other ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("foundry.melt.chem.name")}>
                    <TextInput value={c.name} maxLength={60} onChange={(e) => set({ name: e.currentTarget.value })} data-testid="chem-name" />
                  </Field>
                  <Field label={t("foundry.melt.chem.unit")}>
                    <FieldSelect value={c.unit} onChange={(e) => set({ unit: e.currentTarget.value })}>
                      {CHEMICAL_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </FieldSelect>
                  </Field>
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-3">
                <Field label={t("foundry.melt.chem.open")} error={marked && issue!.code === "chemical" ? t("foundry.melt.issue.chemical") : undefined}>
                  <NumberInput value={c.openText} onValueChange={(v) => set({ openText: v, closeText: "" })} data-testid="chem-open" />
                </Field>
                <Field label={t("foundry.melt.chem.used")}>
                  <NumberInput value={c.usedText} onValueChange={(v) => set({ usedText: v, closeText: "" })} data-testid="chem-used" />
                </Field>
                <Field label={t("foundry.melt.chem.close")} error={marked && issue!.code === "chemicalClose" ? t("foundry.melt.issue.chemicalClose") : undefined}>
                  <TextInput readOnly value={close === null ? "" : String(close / 1000)} aria-readonly="true" data-testid="chem-close" />
                </Field>
              </div>
              <RemoveButton label={t("common.remove")} onClick={() => patch({ chemicals: form.chemicals.filter((x) => x.key !== c.key) })} />
            </div>
          );
        })}
        <div>
          <Button type="button" variant="secondary" disabled={form.chemicals.length >= MAX_CHEMICALS} onClick={() => patch({ chemicals: [...form.chemicals, { key: lineKey(), storeItemId: "", name: "", unit: "", openText: "", usedText: "", closeText: "" }] })} data-testid="add-chem">
            <Plus aria-hidden="true" strokeWidth={2} /> {t("foundry.melt.chem.add")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="ldo-title">
        <SectionTitle>
          <span id="ldo-title">{t("foundry.melt.ldo.title")}</span>
        </SectionTitle>
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.melt.ldo.hint")}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {LDO_KEYS.map((k: LdoKey) => (
            <Field key={k} label={t(`foundry.melt.ldo.${k}`)} error={issue?.code === "ldo" && form.ldo[k].trim() !== "" && kgToG(form.ldo[k]) === null ? t("foundry.melt.issue.ldo") : undefined}>
              <NumberInput value={form.ldo[k]} suffix={t("units.inch")} onValueChange={(v) => patch({ ldo: { ...form.ldo, [k]: v } })} data-testid={`ldo-${k}`} />
            </Field>
          ))}
        </div>
        {ldoUsed !== null ? <p className="m-0 text-[15px] font-semibold tabular-nums" data-testid="ldo-used">{t("foundry.melt.ldo.used", { inches: ldoUsed })}</p> : null}
      </section>
    </div>
  );
}

// --- 4. Output -----------------------------------------------------------------------------------------------------

export function OutputStep({ form, patch, issue, streams, capacityG }: StepProps & { streams: Stream[]; capacityG: number | null }) {
  const { t } = useT();
  const fig = figuresOf(form, capacityG);
  const b = fig.balance;
  const outside = b.metalInG > 0 && (b.needsReason || b.negativeBurn);
  const returnable = streams.filter((s) => s.kind === "charge" && s.active);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="logs-title">
        <SectionTitle>
          <span id="logs-title">{t("foundry.melt.out.logs")}</span>
        </SectionTitle>
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.melt.out.logsHint")}</p>
        {form.logs.map((l, i) => {
          const marked = issue?.step === "output" && issue.line === i && (issue.code === "log" || issue.code === "kgTooLarge");
          const set = (next: Partial<typeof l>) => patch({ logs: form.logs.map((x) => (x.key === l.key ? { ...x, ...next } : x)) });
          return (
            <div key={l.key} className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-3" data-testid="log-line">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label={t("foundry.melt.out.pcs")} error={marked ? t(`foundry.melt.issue.${issue!.code === "log" ? "log" : "kgTooLarge"}`) : undefined}>
                  <NumberInput decimal={false} value={l.pcsText} onValueChange={(v) => set({ pcsText: v })} data-testid="log-pcs" />
                </Field>
                <Field label={t("foundry.melt.out.length")}>
                  <NumberInput value={l.lengthText} suffix={t("units.ft")} onValueChange={(v) => set({ lengthText: v })} data-testid="log-length" />
                </Field>
                <Field label={t("foundry.melt.out.billetLength")} hint={t("foundry.melt.out.billetLengthHint")}>
                  <NumberInput value={l.billetLengthText} suffix={t("units.ft")} onValueChange={(v) => set({ billetLengthText: v })} />
                </Field>
                <Field label={t("foundry.melt.out.kg")}>
                  <NumberInput value={l.kgText} suffix={t("units.kg")} onValueChange={(v) => set({ kgText: v })} data-testid="log-kg" />
                </Field>
              </div>
              <RemoveButton label={t("common.remove")} onClick={() => patch({ logs: form.logs.filter((x) => x.key !== l.key) })} />
            </div>
          );
        })}
        <div>
          <Button type="button" variant="secondary" disabled={form.logs.length >= MAX_LOG_LINES} onClick={() => patch({ logs: [...form.logs, { key: lineKey(), pcsText: "", lengthText: form.logs.at(-1)?.lengthText ?? "", billetLengthText: "", kgText: "" }] })} data-testid="add-log">
            <Plus aria-hidden="true" strokeWidth={2} /> {t("foundry.melt.out.addLog")}
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={t("foundry.melt.out.byproducts")}>
        <Field label={t("foundry.melt.out.dross")}>
          <NumberInput value={form.drossKg} suffix={t("units.kg")} onValueChange={(v) => patch({ drossKg: v })} data-testid="melt-dross" />
        </Field>
        <Field label={t("foundry.melt.out.fe")}>
          <NumberInput value={form.feKg} suffix={t("units.kg")} onValueChange={(v) => patch({ feKg: v })} data-testid="melt-fe" />
        </Field>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="returns-title">
        <SectionTitle>
          <span id="returns-title">{t("foundry.melt.out.returns")}</span>
        </SectionTitle>
        {form.returns.map((r) => (
          <div key={r.key} className={LINE}>
            <div className="min-w-0 flex-1">
              <Field label={t("foundry.melt.charge.stream")}>
                <FieldSelect value={r.streamId} onChange={(e) => patch({ returns: form.returns.map((x) => (x.key === r.key ? { ...x, streamId: e.currentTarget.value } : x)) })}>
                  <option value="">{t("foundry.melt.charge.streamPick")}</option>
                  {returnable.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code}
                    </option>
                  ))}
                </FieldSelect>
              </Field>
            </div>
            <div className="sm:w-44">
              <Field label={t("foundry.melt.out.kg")}>
                <NumberInput value={r.kgText} suffix={t("units.kg")} onValueChange={(v) => patch({ returns: form.returns.map((x) => (x.key === r.key ? { ...x, kgText: v } : x)) })} />
              </Field>
            </div>
            <RemoveButton label={t("common.remove")} onClick={() => patch({ returns: form.returns.filter((x) => x.key !== r.key) })} />
          </div>
        ))}
        <div>
          <Button type="button" variant="ghost" disabled={form.returns.length >= MAX_STREAM_RETURNS || returnable.length === 0} onClick={() => patch({ returns: [...form.returns, { key: lineKey(), streamId: "", kgText: "" }] })}>
            <Plus aria-hidden="true" strokeWidth={2} /> {t("foundry.melt.out.addReturn")}
          </Button>
        </div>
      </section>

      <Balance form={form} capacityG={capacityG} />
      {outside ? (
        <Field label={t("foundry.melt.out.balanceNote")} hint={b.negativeBurn ? t("foundry.melt.out.moreOut") : t("foundry.melt.out.burnHigh")}>
          <FieldTextArea value={form.balanceNote} maxLength={500} onChange={(e) => patch({ balanceNote: e.currentTarget.value })} data-testid="melt-balance-note" />
        </Field>
      ) : null}
    </div>
  );
}

/** The running balance: kg in, out, burn and yield, worked out on the screen for the person typing (the server stores its own). */
export function Balance({ form, capacityG }: { form: MeltForm; capacityG: number | null }) {
  const { t } = useT();
  const fig = figuresOf(form, capacityG);
  const b = fig.balance;
  const tone = b.metalInG === 0 ? "bg-surface-sunken" : b.needsReason || b.negativeBurn ? "bg-tone-amber-tint text-tone-amber-ink" : "bg-tone-green-tint text-tone-green-ink";
  return (
    <p role="status" className={`m-0 flex flex-wrap gap-x-5 gap-y-1 rounded-card px-4 py-3 text-[15px] font-semibold tabular-nums ${tone}`} data-testid="balance-chip">
      <span>{t("foundry.melt.balance.in", { kg: kgFromG(b.metalInG) })}</span>
      <span>{t("foundry.melt.balance.out", { kg: kgFromG(fig.logsG + fig.drossG + fig.feG + fig.returnsG) })}</span>
      <span>{t("foundry.melt.balance.burn", { kg: kgFromG(Math.abs(b.burnG)), pct: bpText(b.balanceBp === null ? null : Math.abs(b.balanceBp)) || "0.0" })}</span>
      <span>{t("foundry.melt.balance.yield", { pct: bpText(b.yieldBp) || "0.0" })}</span>
    </p>
  );
}
