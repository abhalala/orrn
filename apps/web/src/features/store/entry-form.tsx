import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { TextArea } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { BigQty } from "./big-qty";
import { useRequestIds } from "./request-id";
import { recentItemIds, savedOutcome } from "./store-entries";
import { countedIn, purposeLabel, qtyProblemText, unitShort } from "./store-labels";
import {
  formatQty,
  ISSUE_PURPOSES,
  isShort,
  parseQtyMilli,
  type IssuePurpose,
  type StoreUnit,
} from "./store-qty";
import { StoreItemPicker } from "./item-picker";
import { StoreLoadError, StoreNoAccess, StoreNote } from "./store-ui";
import {
  errorMessage,
  useInvalidateStore,
  useStoreAccess,
  useStoreBalances,
  useStoreEntries,
  type StoreBalance,
} from "./use-store";

export type EntryMode = "receive" | "issue" | "exchange";

type Saved = {
  numbers: [string] | [string, string];
  itemName: string;
  milli: number;
  unit: string;
  /** A retry returned an entry someone cancelled meanwhile (RP18): nothing moved now. */
  cancelled: boolean;
};

type FieldKey = "item" | "qty" | "old" | "new" | "purpose";

const COPY = {
  receive: {
    title: "store.receive.title",
    subtitle: "store.receive.subtitle",
    submit: "store.receive.submit",
    done: "store.receive.done",
    again: "store.receive.again",
  },
  issue: {
    title: "store.issue.title",
    subtitle: "store.issue.subtitle",
    submit: "store.issue.submit",
    done: "store.issue.done",
    again: "store.issue.again",
  },
  exchange: {
    title: "store.exchange.title",
    subtitle: "store.exchange.subtitle",
    submit: "store.exchange.submit",
    done: "store.exchange.done",
    again: "store.exchange.again",
  },
} as const;

/**
 * Receive (GRN), Issue (MRS) or Exchange (MRS + GRN) on one floor-first form: item picker with what
 * is in the store, numeric quantity in the item's unit, a sticky submit. An issue (or the old leg of
 * an exchange) larger than the balance is stopped here and refused by the server too. Every submit
 * carries a client request id (RP18), so a double tap or a retry never posts twice.
 */
export function StoreEntryForm({ mode, initialItemId }: { mode: EntryMode; initialItemId?: string }) {
  const { t } = useT();
  const access = useStoreAccess();
  const balances = useStoreBalances(access.canEnter);
  const recentEntries = useStoreEntries({ limit: 30 }, access.canEnter);
  const copy = COPY[mode];

  const header = (
    <PageHeader
      back={{ to: "/store", label: t("store.backToStore") }}
      title={t(copy.title)}
      subtitle={t(copy.subtitle)}
      actions={<HowToButton slug="store-entries" />}
    />
  );

  if (!access.canEnter) {
    return (
      <>
        {header}
        <StoreNoAccess entries />
      </>
    );
  }

  if (balances.isError && !balances.data) {
    return (
      <>
        {header}
        <StoreLoadError onRetry={() => void balances.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}
      {balances.data ? (
        balances.data.locationId === null ? (
          <StoreNote tone="attention" title={t("store.noLocation")} body={t("store.noLocationBody")} />
        ) : (
          <EntryFormBody
            mode={mode}
            items={balances.data.items.filter((i) => i.active)}
            recentIds={recentItemIds(recentEntries.data?.items ?? [])}
            initialItemId={initialItemId}
          />
        )
      ) : (
        <FormSkeleton />
      )}
    </>
  );
}

function FormSkeleton() {
  return (
    <div aria-busy="true" className="flex max-w-[640px] flex-col gap-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-12 w-full" />
        </div>
      ))}
    </div>
  );
}

function EntryFormBody({
  mode,
  items,
  recentIds,
  initialItemId,
}: {
  mode: EntryMode;
  items: StoreBalance[];
  recentIds: string[];
  initialItemId?: string;
}) {
  const { t } = useT();
  const copy = COPY[mode];
  const invalidate = useInvalidateStore();
  const ids = useRequestIds();
  const uid = useId().replace(/:/g, "");

  const [itemId, setItemId] = useState<string | null>(() =>
    initialItemId && items.some((i) => i.id === initialItemId) ? initialItemId : null,
  );
  const [qty, setQty] = useState("");
  const [oldQty, setOldQty] = useState("");
  const [newQty, setNewQty] = useState("");
  const [purpose, setPurpose] = useState<IssuePurpose | null>(null);
  const [ref, setRef] = useState("");
  const [challan, setChallan] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [announce, setAnnounce] = useState("");

  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});
  // Set before the first await: a second tap in the same frame never starts a second request.
  const inFlight = useRef(false);
  const againRef = useRef<HTMLButtonElement | null>(null);

  const item = items.find((i) => i.id === itemId) ?? null;
  const unit = (item?.unit ?? null) as StoreUnit | null;

  const receive = useMutation(trpc.store.receive.mutationOptions());
  const issue = useMutation(trpc.store.issue.mutationOptions());
  const exchange = useMutation(trpc.store.exchange.mutationOptions());
  const mutation = mode === "receive" ? receive : mode === "issue" ? issue : exchange;

  // What is wrong with each field right now (shown once touched or after a submit attempt).
  const problems = useMemo(() => {
    const out: Partial<Record<FieldKey, string>> = {};
    const short: FieldKey[] = [];
    if (!item) out.item = t("store.form.itemRequired");
    const check = (text: string, key: FieldKey, takesFromStore: boolean) => {
      const parsed = parseQtyMilli(text, unit);
      if (!parsed.ok) {
        out[key] = qtyProblemText(t, parsed.problem);
        return null;
      }
      if (takesFromStore && item && isShort(parsed.milli, item.balanceMilli)) {
        short.push(key);
        out[key] = t("store.form.qty.short", {
          qty: formatQty(Math.max(0, item.balanceMilli)),
          unit: unitShort(t, item.unit, item.balanceMilli),
        });
      }
      return parsed.milli;
    };
    let milli: number | null = null;
    let outMilli: number | null = null;
    let inMilli: number | null = null;
    if (mode === "exchange") {
      outMilli = check(oldQty, "old", true);
      inMilli = check(newQty, "new", false);
    } else {
      milli = check(qty, "qty", mode === "issue");
    }
    if (mode === "issue" && !purpose) out.purpose = t("store.form.purposeRequired");
    return { errors: out, short, milli, outMilli, inMilli };
  }, [item, unit, qty, oldQty, newQty, purpose, mode, t]);

  const shownError = (key: FieldKey) => {
    const e = problems.errors[key];
    if (!e) return undefined;
    // "Not enough in the store" shows as soon as it is true: nobody should have to submit to learn it.
    return attempted || touched[key] || problems.short.includes(key) ? e : undefined;
  };

  const touch = (key: FieldKey) => setTouched((s) => ({ ...s, [key]: true }));

  useEffect(() => {
    if (saved) againRef.current?.focus();
  }, [saved]);

  const resetForAnother = () => {
    setQty("");
    setOldQty("");
    setNewQty("");
    setPurpose(null);
    setRef("");
    setChallan("");
    setNote("");
    setTouched({});
    setAttempted(false);
    setSaved(null);
    setAnnounce("");
    mutation.reset();
    requestAnimationFrame(() => fieldRefs.current[mode === "exchange" ? "old" : "qty"]?.focus());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    setAttempted(true);
    const order: FieldKey[] = ["item", "qty", "old", "new", "purpose"];
    const firstBad = order.find((k) => problems.errors[k]);
    if (firstBad || !item) {
      if (firstBad) fieldRefs.current[firstBad]?.focus();
      return;
    }
    const note_ = note.trim() || null;
    inFlight.current = true;
    try {
      if (mode === "receive" && problems.milli !== null) {
        const signature = ["receive", item.id, problems.milli, challan.trim(), note_ ?? ""].join("|");
        const res = await receive.mutateAsync({
          itemId: item.id,
          qtyMilli: problems.milli,
          grnRef: challan.trim() || null,
          note: note_,
          clientRequestId: ids.idFor(signature),
        });
        done({
          numbers: [res.number],
          itemName: item.name,
          milli: problems.milli,
          unit: item.unit,
          cancelled: savedOutcome(res) === "cancelled",
        });
      } else if (mode === "issue" && problems.milli !== null && purpose) {
        const signature = ["issue", item.id, problems.milli, purpose, ref.trim(), note_ ?? ""].join("|");
        const res = await issue.mutateAsync({
          itemId: item.id,
          qtyMilli: problems.milli,
          purpose,
          refId: ref.trim() || null,
          note: note_,
          clientRequestId: ids.idFor(signature),
        });
        done({
          numbers: [res.number],
          itemName: item.name,
          milli: problems.milli,
          unit: item.unit,
          cancelled: savedOutcome(res) === "cancelled",
        });
      } else if (mode === "exchange" && problems.outMilli !== null && problems.inMilli !== null) {
        const signature = ["exchange", item.id, problems.outMilli, problems.inMilli, note_ ?? ""].join("|");
        const res = await exchange.mutateAsync({
          itemId: item.id,
          qtyOutMilli: problems.outMilli,
          qtyInMilli: problems.inMilli,
          note: note_,
          clientRequestId: ids.idFor(signature),
        });
        done({
          numbers: [res.mrsNumber, res.grnNumber],
          itemName: item.name,
          milli: problems.inMilli,
          unit: item.unit,
          cancelled: savedOutcome(res) === "cancelled",
        });
      }
    } catch {
      // The message shows above the submit (mutation.error); the balance may have changed meanwhile.
      void invalidate();
    } finally {
      inFlight.current = false;
    }
  };

  const done = (s: Saved) => {
    ids.reset();
    setSaved(s);
    setAnnounce(
      s.cancelled
        ? `${t("store.replayCancelled.title")}. ${t("store.replayCancelled.body", { number: s.numbers[0] })}`
        : `${t(copy.done)}. ${s.numbers.join(", ")}. ${t("store.qtyOf", { qty: formatQty(s.milli), unit: unitShort(t, s.unit, s.milli), item: s.itemName })}`,
    );
    void invalidate();
  };

  const live = (
    <p role="status" aria-live="polite" className="sr-only">
      {announce}
    </p>
  );

  if (saved) {
    return (
      <div className="flex max-w-[640px] flex-col gap-4">
        {live}
        {saved.cancelled ? (
          <StoreNote
            tone="attention"
            title={t("store.replayCancelled.title")}
            body={t("store.replayCancelled.body", { number: saved.numbers[0] })}
          />
        ) : (
          <StatusBlock
            tone="green"
            title={t(copy.done)}
            meta={
              mode === "exchange" && saved.numbers[1]
                ? t("store.exchange.newInUnder", { number: saved.numbers[1] })
                : t("store.qtyOf", {
                    qty: formatQty(saved.milli),
                    unit: unitShort(t, saved.unit, saved.milli),
                    item: saved.itemName,
                  })
            }
            value={saved.numbers[0]}
            mono
            countUp={false}
            className="animate-pop orrn-block-hero"
          />
        )}
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <Button ref={againRef} size="lg" onClick={resetForAnother}>
            {t(copy.again)}
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link to="/store">{t("store.backToStore")}</Link>
          </Button>
          {item ? (
            <Button asChild variant="ghost" size="lg">
              <Link to="/store/items/$id" params={{ id: item.id }}>
                {item.name}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const suffix = unit ? unitShort(t, unit) : undefined;
  // The point is always accepted, also for pieces: a field that silently drops it turns a typed
  // "1.5" into 15. Countable items get "counted in whole numbers" instead (parseQtyMilli).
  const purposeErrorId = `purpose-error-${uid}`;

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
    >
      {live}
      <div className="flex min-w-0 flex-col gap-5">
        <Field label={t("store.form.item")} error={shownError("item")}>
          <div ref={(el) => void (fieldRefs.current.item = el?.querySelector("input") ?? null)}>
            <StoreItemPicker
              items={items}
              recentIds={recentIds}
              value={itemId}
              onChange={(id) => {
                setItemId(id);
                touch("item");
              }}
            />
          </div>
        </Field>

        {item ? <SelectedItem item={item} className="lg:hidden" /> : null}

        {mode === "exchange" ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label={t("store.form.oldOut")}
              error={shownError("old")}
              hint={item ? inStoreHint(t, item) : undefined}
            >
              <NumberInput
                ref={(el) => void (fieldRefs.current.old = el)}
                value={oldQty}
                onValueChange={setOldQty}
                onBlur={() => touch("old")}
                suffix={suffix}
                aria-required="true"
                enterKeyHint="next"
              />
            </Field>
            <Field label={t("store.form.newIn")} error={shownError("new")}>
              <NumberInput
                ref={(el) => void (fieldRefs.current.new = el)}
                value={newQty}
                onValueChange={setNewQty}
                onBlur={() => touch("new")}
                suffix={suffix}
                aria-required="true"
              />
            </Field>
          </div>
        ) : (
          <Field
            label={t("store.form.quantity")}
            error={shownError("qty")}
            hint={mode === "issue" && item ? inStoreHint(t, item) : undefined}
          >
            <NumberInput
              ref={(el) => void (fieldRefs.current.qty = el)}
              value={qty}
              onValueChange={setQty}
              onBlur={() => touch("qty")}
              suffix={suffix}
              aria-required="true"
              className="h-14 text-[22px] pointer-coarse:h-14"
            />
          </Field>
        )}

        {mode === "issue" ? (
          <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[14px] font-semibold leading-5">{t("store.form.purpose")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {ISSUE_PURPOSES.map((p, i) => {
                const checked = purpose === p;
                return (
                  <label
                    key={p}
                    className={cn(
                      "animate-press relative flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-input border bg-card px-4 py-2 text-[15px] font-semibold transition-[border-color,box-shadow] duration-[var(--dur-fast)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                      checked
                        ? "border-foreground shadow-[inset_0_0_0_1px_var(--foreground)]"
                        : "border-input hover:border-foreground/70",
                    )}
                  >
                    <input
                      ref={i === 0 ? (el) => void (fieldRefs.current.purpose = el) : undefined}
                      type="radio"
                      name={`purpose-${uid}`}
                      value={p}
                      checked={checked}
                      onChange={() => setPurpose(p)}
                      aria-describedby={shownError("purpose") ? purposeErrorId : undefined}
                      aria-invalid={shownError("purpose") ? true : undefined}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                        checked ? "border-foreground bg-foreground text-background" : "border-control",
                      )}
                    >
                      {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 break-words">{purposeLabel(t, p)}</span>
                  </label>
                );
              })}
            </div>
            {shownError("purpose") ? (
              <p id={purposeErrorId} className="m-0 text-[13px] font-medium leading-5 text-destructive">
                {shownError("purpose")}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {mode === "issue" ? (
          <Field label={t("store.form.ref")} hint={t("store.form.refHint")}>
            <TextInput value={ref} onChangeText={setRef} maxLength={64} autoComplete="off" />
          </Field>
        ) : null}

        {mode === "receive" ? (
          <Field label={t("store.form.challan")} hint={t("store.form.challanHint")}>
            <TextInput value={challan} onChangeText={setChallan} maxLength={60} autoComplete="off" />
          </Field>
        ) : null}

        <NoteField value={note} onChange={setNote} />

        {mutation.error ? (
          <p
            role="alert"
            className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words"
          >
            {t("store.form.failed", { reason: errorMessage(mutation.error) })}
          </p>
        ) : null}

        <Can do="store.txn">
          <FormActions className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+12px)]">
            <Button type="submit" size="lg" loading={mutation.isPending}>
              {t(copy.submit)}
            </Button>
          </FormActions>
        </Can>
      </div>

      {item ? <SelectedItem item={item} className="hidden lg:flex" /> : null}
    </form>
  );
}

function inStoreHint(t: ReturnType<typeof useT>["t"], item: StoreBalance): string {
  return t("store.form.quantityHint", {
    qty: formatQty(item.balanceMilli),
    unit: unitShort(t, item.unit, item.balanceMilli),
  });
}

function NoteField({ value, onChange }: { value: string; onChange(v: string): void }) {
  const { t } = useT();
  const id = `store-note-${useId().replace(/:/g, "")}`;
  return (
    <Field label={t("store.form.note")} hint={t("store.form.noteHint")} id={id}>
      <TextArea
        id={id}
        aria-describedby={`${id}-hint`}
        rows={2}
        maxLength={500}
        value={value}
        onChangeText={onChange}
      />
    </Field>
  );
}

/** The chosen item and what is in the store: the number the storekeeper checks before saving. */
function SelectedItem({ item, className }: { item: StoreBalance; className?: string }) {
  const { t } = useT();
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="m-0 text-[15px] font-semibold break-words">
          <Link to="/store/items/$id" params={{ id: item.id }} className="text-foreground no-underline hover:underline">
            {item.name}
          </Link>
        </p>
        <p className="m-0 text-[13px] text-muted-foreground break-words">{countedIn(t, item)}</p>
      </div>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[13px] font-medium text-muted-foreground">{t("store.form.inStoreNow")}</p>
        <BigQty milli={item.balanceMilli} unit={item.unit} />
      </div>
    </div>
  );
}
