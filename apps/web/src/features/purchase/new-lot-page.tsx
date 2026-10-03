/**
 * `/purchase/new`: a truck at the kanta, in four short steps (vendor,
 * material, weights, book). The loud element is the live kanta difference on
 * the weights step; when the lot is short beyond the tolerance the office
 * raises the debit note right there, in the same save. Laptops keep a
 * running summary beside the form; phones see it on the last step.
 */
import { parseDecimal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Stepper } from "@orrn/ui/components/stepper";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { canAny, useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { bookDateText, kgText, pctText } from "./format";
import { readKanta, type KantaReading } from "./kanta";
import {
  BILL_BOOKS,
  EMPTY_DRAFT,
  LOT_STEPS,
  draftToCreateInput,
  draftToNoteInput,
  firstStepWithErrors,
  stepErrors,
  type DraftErrors,
  type LotDraft,
  type LotStep,
} from "./lot-draft";
import { useInvalidatePurchase } from "./lot-sheets";
import { useCompanyToday, useLotPerms, useToleranceBp } from "./lot-ui";
import { formatRate } from "./lot-view";

export function NewLotPage() {
  const { t } = useT();
  const perms = useLotPerms();
  if (!perms.receipt) {
    return (
      <>
        <PageHeader title={t("purchase.new.title")} back={{ to: "/purchase", label: t("purchase.title") }} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState title={t("errors.forbidden")} />
        </div>
      </>
    );
  }
  return <NewLotForm />;
}

function NewLotForm() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const perms = useLotPerms();
  const tolBp = useToleranceBp();
  const today = useCompanyToday();
  const invalidate = useInvalidatePurchase();
  const [draft, setDraft] = useState<LotDraft>(() => ({ ...EMPTY_DRAFT, date: today }));
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const step: LotStep = LOT_STEPS[stepIndex]!;
  const last = stepIndex === LOT_STEPS.length - 1;
  const opts = { toleranceBp: tolBp };
  const errors = showErrors ? stepErrors(draft, step, opts) : {};
  const set = (patch: Partial<LotDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const reading = readKanta(draft.partyText, draft.fcText, tolBp);

  const items = useQuery(trpc.purchase.scrapItems.list.queryOptions());
  const grades = useQuery(trpc.purchase.scrapGrades.list.queryOptions());
  const activeItems = useMemo(() => (items.data?.items ?? []).filter((i) => i.active), [items.data]);
  const activeGrades = useMemo(() => (grades.data?.items ?? []).filter((g) => g.active), [grades.data]);
  const itemName = (id: string | null) => activeItems.find((i) => i.id === id)?.name ?? "";

  // Move focus to the step's heading so keyboard and screen reader users start at the new step.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  const save = async () => {
    const bad = firstStepWithErrors(draft, opts);
    if (bad) {
      setShowErrors(true);
      setStepIndex(LOT_STEPS.indexOf(bad));
      return;
    }
    setSaving(true);
    try {
      const lot = await trpcClient.purchase.lots.create.mutate(draftToCreateInput(draft));
      const noteInput = perms.dcnote ? draftToNoteInput(draft, lot.id, tolBp) : null;
      if (noteInput) {
        try {
          const note = await trpcClient.purchase.dcNotes.create.mutate(noteInput);
          toast.success(t("purchase.new.savedWithNote", { number: lot.number, note: note.number }));
        } catch (e) {
          toast.error(t("purchase.new.noteFailed", { number: lot.number, error: e instanceof Error ? e.message : "" }));
        }
      } else {
        toast.success(t("purchase.new.saved", { number: lot.number }));
      }
      await invalidate();
      await navigate({ to: "/purchase/$id", params: { id: lot.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
      setSaving(false);
    }
  };

  const next = () => {
    if (Object.keys(stepErrors(draft, step, opts)).length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (last) void save();
    else setStepIndex((i) => i + 1);
  };
  const back = () => {
    setShowErrors(false);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const stepLabels = LOT_STEPS.map((s) => t(`purchase.new.steps.${s}`));

  return (
    <>
      <PageHeader
        title={t("purchase.new.title")}
        subtitle={t("purchase.new.subtitle")}
        back={{ to: "/purchase", label: t("purchase.title") }}
        actions={<HowToButton slug="weigh-scrap-lot" />}
      />
      <Stepper steps={stepLabels} current={stepIndex} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          noValidate
          aria-labelledby="lot-step-heading"
          className="flex min-w-0 flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <h2
            id="lot-step-heading"
            ref={headingRef}
            tabIndex={-1}
            className="m-0 font-display text-[22px] font-bold tracking-[-0.025em] outline-none"
          >
            {stepLabels[stepIndex]}
          </h2>

          {step === "vendor" ? (
            <VendorStep draft={draft} set={set} errors={errors} itemName={itemName} />
          ) : step === "material" ? (
            <MaterialStep
              draft={draft}
              set={set}
              errors={errors}
              loading={items.isLoading || grades.isLoading}
              items={activeItems}
              grades={activeGrades}
            />
          ) : step === "weights" ? (
            <WeightsStep draft={draft} set={set} errors={errors} reading={reading} toleranceBp={tolBp} canNote={perms.dcnote} />
          ) : (
            <BookStep draft={draft} set={set} errors={errors} />
          )}

          {last ? (
            <div className="lg:hidden">
              <Summary
                draft={draft}
                reading={reading}
                toleranceBp={tolBp}
                itemName={itemName(draft.itemId)}
                locale={locale}
                canNote={perms.dcnote}
              />
            </div>
          ) : null}

          <div className="sticky bottom-[calc(var(--shell-tabbar-offset)+12px)] z-10 flex gap-2 rounded-card border border-border bg-card/95 p-2 shadow-md backdrop-blur-md md:static md:justify-end md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none [&>*]:flex-1 md:[&>*]:flex-none">
            {stepIndex > 0 ? (
              <Button type="button" size="lg" variant="secondary" onClick={back} disabled={saving}>
                {t("common.back")}
              </Button>
            ) : null}
            <Button type="submit" size="lg" loading={saving}>
              {last ? t("purchase.new.save") : t("common.next")}
            </Button>
          </div>
        </form>

        <aside aria-label={t("purchase.new.summary")} className="sticky top-24 hidden lg:block">
          <Summary
                draft={draft}
                reading={reading}
                toleranceBp={tolBp}
                itemName={itemName(draft.itemId)}
                locale={locale}
                canNote={perms.dcnote}
              />
        </aside>
      </div>
    </>
  );
}

type StepProps = { draft: LotDraft; set(patch: Partial<LotDraft>): void; errors: DraftErrors };

/* -------------------------------------------------------------------------- */
/* Vendor                                                                     */
/* -------------------------------------------------------------------------- */

function VendorStep({ draft, set, errors, itemName }: StepProps & { itemName(id: string | null): string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const canAdd = canAny(me, ["masters.publish", "masters.draft", "purchase.receipt"]);

  const recentLots = useQuery(trpc.purchase.lots.list.queryOptions({ limit: 20, offset: 0 }));
  const recent: ComboboxOption<string>[] = useMemo(() => {
    const seen = new Map<string, ComboboxOption<string>>();
    for (const l of recentLots.data?.items ?? []) {
      if (!seen.has(l.vendorId)) seen.set(l.vendorId, { value: l.vendorId, label: l.vendorName });
    }
    return [...seen.values()].slice(0, 5);
  }, [recentLots.data]);

  const vendor = useQuery({ ...trpc.vendor.get.queryOptions({ id: draft.vendorId ?? "" }), enabled: Boolean(draft.vendorId) });

  // Names of every vendor offered so far, so the summary can show the one picked.
  const labels = useRef(new Map<string, string>());
  for (const r of recent) labels.current.set(r.value, r.label);

  const search = async (q: string): Promise<ComboboxOption<string>[]> => {
    const res = await queryClient.fetchQuery(trpc.vendor.list.queryOptions({ q, limit: 20, offset: 0 }));
    return res.items.map((v) => {
      labels.current.set(v.id, v.name);
      return {
        value: v.id,
        label: v.name,
        hint: [v.city, v.status === "draft" ? t("purchase.new.draftVendor") : null].filter(Boolean).join(", ") || undefined,
      };
    });
  };

  return (
    <>
      <Field label={t("purchase.new.vendor")} hint={t("purchase.new.vendorHint")} error={errors.vendor ? t(errors.vendor) : undefined}>
        <Combobox
          value={draft.vendorId}
          valueLabel={draft.vendorLabel}
          onChange={(id) => set({ vendorId: id, vendorLabel: labels.current.get(id) ?? "" })}
          search={search}
          placeholder={t("purchase.new.vendorPlaceholder")}
          recent={recent}
        />
      </Field>
      {canAdd ? (
        <Button type="button" variant="secondary" className="self-start" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" strokeWidth={2} />
          {t("purchase.new.addVendor")}
        </Button>
      ) : null}

      {vendor.data && vendor.data.usualItems.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[14px] font-semibold">{t("purchase.new.usual")}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {vendor.data.usualItems.slice(0, 4).map((u) => {
              const name = itemName(u.scrapItemId);
              if (!name) return null;
              return (
                <li key={u.scrapItemId}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => set({ itemId: u.scrapItemId, rateText: String(u.lastRatePaise / 100) })}
                  >
                    {t("purchase.new.usualPick", { item: name, rate: formatRate(u.lastRatePaise) })}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <VendorSheet
        open={adding}
        onOpenChange={setAdding}
        onAdded={(id, name) => set({ vendorId: id, vendorLabel: name })}
      />
    </>
  );
}

function VendorSheet({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onAdded(id: string, name: string): void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setCity("");
      setPhone("");
      setSubmitted(false);
    }
  }, [open]);
  const create = useMutation(
    trpc.vendor.create.mutationOptions({
      onSuccess: async (res) => {
        await queryClient.invalidateQueries({ queryKey: trpc.vendor.pathKey() });
        toast.success(t("purchase.new.vendorAdded"));
        onAdded(res.id, name.trim());
        onOpenChange(false);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const nameError = name.trim() === "" ? t("errors.required") : undefined;
  const submit = () => {
    setSubmitted(true);
    if (nameError) return;
    create.mutate({
      name: name.trim(),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("purchase.new.addVendorTitle")}
      description={t("purchase.new.addVendorBody")}
      footer={
        <>
          <Button size="lg" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" loading={create.isPending} onClick={submit}>
            {t("purchase.new.saveVendor")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("purchase.new.vendorName")} error={submitted ? nameError : undefined}>
          <TextInput value={name} onChangeText={setName} maxLength={120} autoComplete="organization" />
        </Field>
        <Field label={`${t("purchase.new.vendorCity")} (${t("common.optional").toLowerCase()})`}>
          <TextInput value={city} onChangeText={setCity} maxLength={80} />
        </Field>
        <Field label={`${t("purchase.new.vendorPhone")} (${t("common.optional").toLowerCase()})`}>
          <TextInput value={phone} onChangeText={setPhone} maxLength={40} type="tel" inputMode="tel" autoComplete="tel" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Material                                                                   */
/* -------------------------------------------------------------------------- */

/** Big radio pills: native radios, so arrow keys move between them and the group reads as one choice. */
function ChoicePills({
  legend,
  name,
  value,
  options,
  onChange,
  error,
  mono,
}: {
  legend: string;
  name: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange(v: string): void;
  error?: string;
  mono?: boolean;
}) {
  const errorId = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-2 p-0 text-[14px] font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              aria-invalid={error ? true : undefined}
              className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
            />
            <span
              className={cn(
                "flex min-h-12 items-center rounded-full border border-border bg-card px-4 text-[15px] font-semibold transition-[background-color,color,border-color,scale] duration-[var(--dur-fast)] select-none peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid peer-active:scale-[0.97] hover:border-foreground/60",
                mono && "font-mono",
              )}
            >
              {o.label}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="m-0 text-[13px] font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function MaterialStep({
  draft,
  set,
  errors,
  loading,
  items,
  grades,
}: StepProps & {
  loading: boolean;
  items: { id: string; name: string }[];
  grades: { id: string; code: string }[];
}) {
  const { t } = useT();
  if (loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-32 rounded-full" />
          ))}
        </div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState title={t("purchase.new.noItems")} />
      </div>
    );
  }
  return (
    <>
      <ChoicePills
        legend={t("purchase.new.item")}
        name="lot-item"
        value={draft.itemId}
        options={items.map((i) => ({ value: i.id, label: i.name }))}
        onChange={(itemId) => set({ itemId })}
        error={errors.item ? t(errors.item) : undefined}
      />
      <ChoicePills
        legend={t("purchase.new.grade")}
        name="lot-grade"
        value={draft.grade}
        options={grades.map((g) => ({ value: g.code, label: g.code }))}
        onChange={(grade) => set({ grade })}
        error={errors.grade ? t(errors.grade) : undefined}
        mono
      />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t("purchase.new.rate")} error={errors.rate ? t(errors.rate) : undefined}>
          <NumberInput value={draft.rateText} onValueChange={(rateText) => set({ rateText })} suffix="₹" />
        </Field>
        <Field label={`${t("purchase.new.dross")} (${t("common.optional").toLowerCase()})`} error={errors.dross ? t(errors.dross) : undefined}>
          <NumberInput value={draft.drossText} onValueChange={(drossText) => set({ drossText })} suffix="%" />
        </Field>
      </div>
      <Field
        label={`${t("purchase.new.origin")} (${t("common.optional").toLowerCase()})`}
        hint={t("purchase.new.originHint")}
        error={errors.origin ? t(errors.origin) : undefined}
      >
        <TextInput value={draft.origin} onChangeText={(origin) => set({ origin })} maxLength={80} />
      </Field>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Weights                                                                    */
/* -------------------------------------------------------------------------- */

const KANTA_TONE: Record<KantaReading["state"], "neutral" | "green" | "red"> = {
  incomplete: "neutral",
  even: "green",
  over: "green",
  within: "green",
  short: "red",
};

function WeightsStep({
  draft,
  set,
  errors,
  reading,
  toleranceBp,
  canNote,
}: StepProps & { reading: KantaReading; toleranceBp: number; canNote: boolean }) {
  const { t } = useT();
  const pct = pctText(toleranceBp);
  const word =
    reading.state === "incomplete"
      ? t("purchase.diffWord.incomplete")
      : reading.state === "even"
        ? t("purchase.diffWord.even")
        : reading.state === "over"
          ? t("purchase.diffWord.over")
          : reading.state === "within"
            ? t("purchase.diffWord.within", { pct })
            : t("purchase.diffWord.short", { pct });

  // Start the note at the whole short the first time the lot turns short; never overwrite what was typed.
  const prefilled = useRef(false);
  useEffect(() => {
    if (reading.needsNote && !prefilled.current && draft.noteKgText === "") {
      prefilled.current = true;
      set({ noteKgText: String(reading.shortG / 1000) });
    }
  }, [reading.needsNote, reading.shortG, draft.noteKgText, set]);

  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t("purchase.new.party")} hint={t("purchase.new.partyHint")} error={errors.party ? t(errors.party) : undefined}>
          <NumberInput value={draft.partyText} onValueChange={(partyText) => set({ partyText })} suffix="kg" className="h-14 text-[22px] pointer-coarse:h-14" />
        </Field>
        <Field label={t("purchase.new.fc")} hint={t("purchase.new.fcHint")} error={errors.fc ? t(errors.fc) : undefined}>
          <NumberInput value={draft.fcText} onValueChange={(fcText) => set({ fcText })} suffix="kg" className="h-14 text-[22px] pointer-coarse:h-14" />
        </Field>
      </div>

      <section
        aria-label={t("purchase.new.difference")}
        data-testid="kanta-difference"
        data-state={reading.state}
        className={cn(
          "orrn-block orrn-block-sheen flex min-w-0 flex-col gap-2 p-5 transition-[background] duration-[var(--dur-base)]",
          `orrn-block-${KANTA_TONE[reading.state]}`,
        )}
      >
        <span className="relative text-[14px] font-semibold">{t("purchase.new.difference")}</span>
        <p data-no-truncate="" className="relative m-0 flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-[48px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
            {reading.diffG === null ? "-" : kgText(Math.abs(reading.diffG))}
          </span>
          {reading.diffG !== null ? <span className="text-[16px] font-semibold">kg</span> : null}
        </p>
        <p aria-live="polite" className="relative m-0 text-[15px] font-semibold break-words">
          {word}
        </p>
        {reading.partyG !== null ? (
          <p className="relative m-0 text-[14px] font-medium">
            {t("purchase.tolerance", { kg: kgText(reading.toleranceG), pct })}
          </p>
        ) : null}
      </section>

      {reading.needsNote ? (
        canNote ? (
          <section aria-labelledby="inline-note-title" className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
            <h3 id="inline-note-title" className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">
              {t("purchase.new.noteTitle")}
            </h3>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground">
              {t("purchase.new.noteBody", { kg: kgText(reading.shortG), pct, min: kgText(reading.minNoteG) })}
            </p>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-semibold">
              <input
                type="checkbox"
                checked={draft.raiseNote}
                onChange={(e) => set({ raiseNote: e.currentTarget.checked })}
                className="size-5 shrink-0 accent-[var(--primary)]"
              />
              {t("purchase.new.raiseNote")}
            </label>
            {draft.raiseNote ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field
                  label={t("purchase.new.noteKg")}
                  hint={t("purchase.new.noteKgHint", { min: kgText(reading.minNoteG) })}
                  error={errors.noteKg ? t(errors.noteKg) : undefined}
                >
                  <NumberInput value={draft.noteKgText} onValueChange={(noteKgText) => set({ noteKgText })} suffix="kg" />
                </Field>
                <Field
                  label={`${t("purchase.new.bori")} (${t("common.optional").toLowerCase()})`}
                  hint={t("purchase.new.boriHint")}
                  error={errors.bori ? t(errors.bori) : undefined}
                >
                  <NumberInput value={draft.boriText} onValueChange={(boriText) => set({ boriText })} suffix="kg" />
                </Field>
                <Field label={`${t("purchase.new.noteText")} (${t("common.optional").toLowerCase()})`} className="sm:col-span-2">
                  <TextInput value={draft.noteText} onChangeText={(noteText) => set({ noteText })} maxLength={500} />
                </Field>
              </div>
            ) : null}
          </section>
        ) : (
          <p role="status" className="m-0 rounded-card border border-border bg-card px-4 py-3 text-[15px] leading-6">
            {t("purchase.new.noteOffice")}
          </p>
        )
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Book                                                                       */
/* -------------------------------------------------------------------------- */

function BookStep({ draft, set, errors }: StepProps) {
  const { t } = useT();
  const optional = t("common.optional").toLowerCase();
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-[14px] font-semibold">{t("purchase.new.billBook")}</span>
        <SegmentedControl
          label={t("purchase.new.billBook")}
          value={draft.billBook}
          onChange={(billBook) => set({ billBook })}
          options={BILL_BOOKS.map((b) => ({ value: b, label: t(`purchase.billBooks.${b}`) }))}
        />
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("purchase.new.billBookHint")}</p>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t("purchase.new.date")} error={errors.date ? t(errors.date) : undefined}>
          <TextInput type="date" value={draft.date} onChangeText={(date) => set({ date })} />
        </Field>
        <Field label={`${t("purchase.new.vehicleNo")} (${optional})`} error={errors.vehicle ? t(errors.vehicle) : undefined}>
          <TextInput
            value={draft.vehicleNo}
            onChangeText={(vehicleNo) => set({ vehicleNo })}
            maxLength={20}
            autoCapitalize="characters"
            className="font-mono uppercase"
          />
        </Field>
        <Field label={`${t("purchase.new.partyBillNo")} (${optional})`} error={errors.billNo ? t(errors.billNo) : undefined}>
          <TextInput value={draft.partyBillNo} onChangeText={(partyBillNo) => set({ partyBillNo })} maxLength={60} />
        </Field>
      </div>
      <Field label={`${t("purchase.new.notes")} (${optional})`} error={errors.notes ? t(errors.notes) : undefined}>
        <TextInput value={draft.notes} onChangeText={(notes) => set({ notes })} maxLength={500} />
      </Field>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

function Summary({
  draft,
  reading,
  toleranceBp,
  itemName,
  locale,
  canNote,
}: {
  draft: LotDraft;
  reading: KantaReading;
  toleranceBp: number;
  itemName: string;
  locale: "en" | "hi";
  canNote: boolean;
}) {
  const { t } = useT();
  const none = t("purchase.new.notChosen");
  const rate = parseDecimal(draft.rateText);
  const rows: [string, ReactNode][] = [
    [t("purchase.new.vendor"), draft.vendorLabel || none],
    [t("purchase.new.item"), itemName ? (draft.grade ? t("purchase.material", { item: itemName, grade: draft.grade }) : itemName) : none],
    [t("purchase.new.rate"), rate !== null && rate > 0 ? <span className="font-mono">{formatRate(Math.round(rate * 100))}</span> : none],
    [t("purchase.detail.party"), reading.partyG !== null ? <span className="font-mono">{kgText(reading.partyG)} kg</span> : none],
    [t("purchase.detail.ours"), reading.fcG !== null ? <span className="font-mono">{kgText(reading.fcG)} kg</span> : none],
    [t("purchase.detail.billBook"), t(`purchase.billBooks.${draft.billBook}`)],
    [t("purchase.new.date"), draft.date ? bookDateText(draft.date, locale) : none],
  ];
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">{t("purchase.new.summary")}</h2>
      <dl className="m-0 flex flex-col divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-h-10 flex-wrap items-baseline justify-between gap-x-3 py-1.5 text-[14px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 text-right font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {reading.state === "short" && !(canNote && draft.raiseNote) ? (
        <Chip tone="red" className="self-start">
          {t("purchase.flag.shortWithoutNote")}
        </Chip>
      ) : reading.state !== "incomplete" ? (
        <span className="text-[14px] text-muted-foreground">
          {t("purchase.tolerance", { kg: kgText(reading.toleranceG), pct: pctText(toleranceBp) })}
        </span>
      ) : null}
    </section>
  );
}
