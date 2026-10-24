import { formatKg, formatKgTotal, formatLength, gToKg, lengthFromInput, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { NumberInput, TextInput } from "@orrn/ui/components/field";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Pencil } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { DieOption } from "./die-step";
import { lengthToInput, parsePieces, parseWeightG } from "./pack-math";
import {
  Measure,
  PackBar,
  RangeChip,
  bundleRange,
  formatK12,
  formatRangeKg,
  useVerdictWord,
  type RangeState,
} from "./pack-ui";
import {
  MAX_BUNDLES,
  addBundle,
  removeBundle,
  replaceBundle,
  type DraftBundle,
  type PackDraft,
} from "./use-pack-draft";

type Props = {
  draft: PackDraft;
  update(fn: (d: PackDraft) => PackDraft): void;
  unit: LengthUnit;
  die: DieOption | null;
  dieLoading: boolean;
  /** Whether the die's range is known yet; until then chips and announcements do not judge. */
  rangeState: RangeState;
  onRetryDie(): void;
  /** The session's yard code ("Y3"), or null when the company packs without yards. */
  yardCode: string | null;
  onChangeDefaults(): void;
  onReview(): void;
  announce(message: string): void;
};

/** "52.4" for the weight field from stored grams (no grouping, no trailing zeros). */
const weightText = (g: number) => String(Number(gToKg(g).toFixed(3)));

/**
 * Step 2: one open card per bundle with just Weight (kg) and Pieces. Enter in
 * Weight moves to Pieces; Enter in Pieces saves the bundle and opens the next
 * card. kg/12ft is worked out live and coloured against the die's range.
 * Saved bundles collapse to rows above the card; a row opens that bundle
 * for editing or removal. The bar keeps the running total and Review in reach.
 */
export function BundlesStep({
  draft,
  update,
  unit,
  die,
  dieLoading,
  rangeState,
  onRetryDie,
  yardCode,
  onChangeDefaults,
  onReview,
  announce,
}: Props) {
  const { t } = useT();
  const verdictWord = useVerdictWord();
  const uid = useId();
  const weightRef = useRef<HTMLInputElement | null>(null);
  const piecesRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLFormElement | null>(null);
  // Bumped whenever the card should come back into view (after the list above it has re-rendered).
  const [revealTick, setRevealTick] = useState(0);

  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [weight, setWeight] = useState("");
  const [pieces, setPieces] = useState("");
  const [override, setOverride] = useState(false);
  const [len, setLen] = useState({ mm: "", feet: "", inches: "" });
  const [po, setPo] = useState("");
  const [errors, setErrors] = useState<{ weight?: string; pieces?: string; length?: string }>({});
  const [popped, setPopped] = useState<number | null>(null);

  const defaultLength = draft.defaults.lengthMm;
  const full = editIndex === null && draft.bundles.length >= MAX_BUNDLES;

  /** Focus Weight without the browser's own scroll, which can leave it under the sticky bar. */
  const focusWeight = () => {
    weightRef.current?.focus({ preventScroll: true });
    setRevealTick((n) => n + 1);
  };

  // Land on the weight field when the step opens.
  useEffect(() => {
    focusWeight();
  }, []);

  // Keep the whole open card above the sticky bar and tab bar (its scroll margins), once rows above it have rendered.
  useLayoutEffect(() => {
    if (revealTick > 0) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [revealTick]);

  const resetCard = () => {
    setEditIndex(null);
    setWeight("");
    setPieces("");
    setOverride(false);
    setLen({ mm: "", feet: "", inches: "" });
    setPo("");
    setErrors({});
  };

  const overrideLengthTyped = override && (len.mm.trim() || len.feet.trim() || len.inches.trim());
  const overrideLength = overrideLengthTyped ? lengthFromInput({ unit, ...len }) : null;
  const liveLength = overrideLength ?? defaultLength;
  const liveWeightG = parseWeightG(weight);
  const livePieces = parsePieces(pieces);
  const live =
    liveWeightG !== null && livePieces !== null
      ? bundleRange({ weightG: liveWeightG, pieces: livePieces, lengthMm: liveLength }, die)
      : null;

  /** Validates the card; returns the bundle or null (errors shown, focus on the first bad field). */
  const readCard = (): DraftBundle | null => {
    const weightG = parseWeightG(weight);
    const pcs = parsePieces(pieces);
    const next: typeof errors = {};
    if (weightG === null) next.weight = t("pack.new.weightRequired");
    if (pcs === null) next.pieces = t("pack.new.piecesRequired");
    if (overrideLengthTyped && overrideLength === null) next.length = t("pack.new.cutLengthRequired");
    setErrors(next);
    if (next.weight) weightRef.current?.focus();
    else if (next.pieces) piecesRef.current?.focus();
    if (weightG === null || pcs === null || next.length) return null;
    const ownPo = override ? po.trim() : "";
    return {
      weightG,
      pieces: pcs,
      ...(overrideLength !== null && overrideLength !== defaultLength ? { lengthMm: overrideLength } : {}),
      ...(ownPo && ownPo !== (draft.defaults.po ?? "") ? { po: ownPo } : {}),
    };
  };

  const save = (): boolean => {
    const b = readCard();
    if (!b) return false;
    const r = bundleRange({ ...b, lengthMm: b.lengthMm ?? defaultLength }, die);
    if (editIndex !== null) {
      update((d) => replaceBundle(d, editIndex, b));
      announce(t("pack.new.bundleUpdated", { n: editIndex + 1 }));
      setPopped(editIndex);
    } else {
      const n = draft.bundles.length + 1;
      update((d) => addBundle(d, b));
      announce(
        t("pack.new.bundleSaved", {
          n,
          kg: formatKg(gToKg(b.weightG)),
          pieces: b.pieces,
          status: verdictWord(r.verdict, rangeState),
        }),
      );
      setPopped(n - 1);
    }
    resetCard();
    focusWeight();
    return true;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save();
  };

  const onWeightKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (parseWeightG(weight) === null) {
      setErrors((x) => ({ ...x, weight: t("pack.new.weightRequired") }));
      return;
    }
    setErrors((x) => ({ ...x, weight: undefined }));
    piecesRef.current?.focus();
  };

  /**
   * True when the open card holds typing that is not saved: a new bundle with
   * anything typed, or a saved bundle whose fields were changed.
   */
  const cardDirty = (): boolean => {
    if (editIndex === null) return weight.trim() !== "" || pieces.trim() !== "";
    const b = draft.bundles[editIndex];
    if (!b) return false;
    const was = lengthToInput(b.lengthMm ?? 0, unit);
    return (
      parseWeightG(weight) !== b.weightG ||
      parsePieces(pieces) !== b.pieces ||
      override !== (b.lengthMm !== undefined || b.po !== undefined) ||
      (override &&
        (len.mm.trim() !== was.mm || len.feet.trim() !== was.feet || len.inches.trim() !== was.inches || po !== (b.po ?? "")))
    );
  };

  const startEdit = (i: number) => {
    const b = draft.bundles[i];
    if (!b || i === editIndex) return;
    // Never drop typing silently: save the open card first (its field error shows if it can't be saved).
    if (cardDirty() && !save()) return;
    setEditIndex(i);
    setWeight(weightText(b.weightG));
    setPieces(String(b.pieces));
    const own = b.lengthMm !== undefined || b.po !== undefined;
    setOverride(own);
    setLen(lengthToInput(b.lengthMm ?? 0, unit));
    setPo(b.po ?? "");
    setErrors({});
    requestAnimationFrame(focusWeight);
  };

  const remove = () => {
    if (editIndex === null) return;
    const n = editIndex + 1;
    update((d) => removeBundle(d, editIndex));
    announce(t("pack.new.bundleRemoved", { n }));
    setPopped(null);
    resetCard();
    focusWeight();
  };

  const review = () => {
    // A bundle typed (or a correction made) but not saved yet is saved first, so Review never drops it.
    if (cardDirty() && !save()) return;
    onReview();
  };

  const totals = draft.bundles.reduce(
    (acc, b) => ({ pieces: acc.pieces + b.pieces, weightG: acc.weightG + b.weightG }),
    { pieces: 0, weightG: 0 },
  );
  const cardNumber = editIndex !== null ? editIndex + 1 : draft.bundles.length + 1;
  const overrideId = `${uid}-override`;

  return (
    <div className="flex flex-col gap-4">
      <SessionStrip
        draft={draft}
        unit={unit}
        die={die}
        dieLoading={dieLoading}
        yardCode={yardCode}
        onChange={onChangeDefaults}
      />

      {rangeState === "failed" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-tone-red-tint px-4 py-2.5 text-tone-red-ink"
        >
          <p className="m-0 min-w-0 flex-1 basis-[14rem] text-[14px] font-medium">{t("pack.new.rangeFailed")}</p>
          <Button variant="secondary" onClick={onRetryDie}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      <section aria-labelledby={`${uid}-saved`} className="flex flex-col gap-2">
        <h3 id={`${uid}-saved`} className="m-0 text-[15px] font-semibold">
          {t("pack.new.savedBundles")}
        </h3>
        {draft.bundles.length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{t("pack.new.noBundlesYet")}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {draft.bundles.map((b, i) => (
              <li key={`${i}-${b.weightG}-${b.pieces}`}>
                <SavedRow
                  index={i}
                  bundle={b}
                  unit={unit}
                  defaultLength={defaultLength}
                  die={die}
                  rangeState={rangeState}
                  editing={editIndex === i}
                  popped={popped === i}
                  onEdit={() => startEdit(i)}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      {full ? (
        <p
          role="status"
          className="m-0 rounded-card bg-tone-amber-tint px-4 py-3 text-[14px] font-medium text-tone-amber-ink"
        >
          {t("pack.new.maxReached", { max: MAX_BUNDLES })}
        </p>
      ) : (
        <form
          ref={cardRef}
          noValidate
          onSubmit={onSubmit}
          aria-labelledby={`${uid}-card`}
          data-slot="bundle-card"
          data-editing={editIndex !== null || undefined}
          className={cn(
            "flex scroll-mt-24 scroll-mb-[calc(var(--shell-tabbar-offset)+108px)] flex-col gap-4 rounded-card border bg-card p-4 shadow-md sm:p-5",
            editIndex !== null ? "border-foreground" : "border-border",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${uid}-card`} className="m-0 font-display text-[20px] font-bold tracking-[-0.02em]">
              {editIndex !== null
                ? t("pack.new.editingBundle", { n: cardNumber })
                : t("pack.new.bundleNumber", { n: cardNumber })}
            </h3>
            {editIndex !== null ? (
              <Button variant="ghost" onClick={resetCard}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] md:gap-4">
            <BigNumberField
              id={`${uid}-w`}
              inputRef={weightRef}
              label={t("pack.new.weight")}
              value={weight}
              onChange={(v) => {
                setWeight(v);
                if (errors.weight) setErrors((x) => ({ ...x, weight: undefined }));
              }}
              onKeyDown={onWeightKey}
              suffix={t("units.kg")}
              error={errors.weight}
              enterKeyHint="next"
            />
            <BigNumberField
              id={`${uid}-p`}
              inputRef={piecesRef}
              label={t("pack.new.pieces")}
              value={pieces}
              onChange={(v) => {
                setPieces(v);
                if (errors.pieces) setErrors((x) => ({ ...x, pieces: undefined }));
              }}
              suffix={t("units.pcs")}
              error={errors.pieces}
              enterKeyHint="next"
            />
            <LiveReadout
              k={live?.k ?? null}
              verdict={live?.verdict ?? null}
              rangeState={rangeState}
              die={die}
              className="col-span-2 md:col-span-1"
            />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={override}
              aria-controls={overrideId}
              onClick={() => {
                // Opening the panel makes the card taller: bring Save bundle back above the bar.
                if (!override) setRevealTick((n) => n + 1);
                setOverride((o) => !o);
              }}
              className="animate-press -ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-full px-2 text-[15px] font-semibold text-foreground transition-colors duration-[var(--dur-fast)] hover:bg-accent"
            >
              <ChevronDown
                aria-hidden="true"
                strokeWidth={2}
                className={cn("size-5 transition-transform duration-[var(--dur-fast)]", override && "rotate-180")}
              />
              {t("pack.new.differentLengthPo")}
            </button>
            <div
              id={overrideId}
              hidden={!override}
              className="grid gap-3 rounded-input bg-surface-sunken p-3 sm:grid-cols-2 sm:p-4"
            >
              <OverrideLength unit={unit} value={len} onChange={setLen} error={errors.length} uid={uid} />
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={`${uid}-po`} className="text-[14px] font-semibold leading-5">
                  {t("pack.new.poForBundle")}
                </label>
                <TextInput
                  id={`${uid}-po`}
                  value={po}
                  onChange={(e) => setPo(e.currentTarget.value)}
                  maxLength={500}
                  autoComplete="off"
                  placeholder={draft.defaults.po ?? ""}
                  className="h-12 font-mono text-[16px]"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="lg" className="max-sm:flex-1 sm:min-w-[200px]">
              {t("pack.new.saveBundle")}
            </Button>
            {editIndex !== null ? (
              <Button variant="ghost" size="lg" onClick={remove} className="text-destructive">
                {t("pack.new.removeBundle")}
              </Button>
            ) : null}
          </div>
        </form>
      )}

      <PackBar
        summary={
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] font-medium text-muted-foreground max-sm:sr-only">
              {t("pack.new.runningTotal")}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[15px] font-semibold">
              <span data-testid="pack-total-bundles" className="whitespace-nowrap">
                {t("units.bundles", { count: draft.bundles.length })}
              </span>
              <Measure value={totals.pieces.toLocaleString("en-IN")} unit={t("units.pcs")} />
              <Measure value={formatKgTotal(gToKg(totals.weightG))} unit={t("units.kg")} />
            </span>
          </div>
        }
      >
        <Button size="lg" onClick={review} disabled={draft.bundles.length === 0 && !(weight.trim() && pieces.trim())}>
          {t("pack.new.review")}
        </Button>
      </PackBar>
    </div>
  );
}

/**
 * Weight or Pieces. Both accept a typed "." (NumberInput with decimals on):
 * a whole-number-only input drops the "." silently, so "20.5" pieces would
 * become 205; instead parsePieces refuses it with "Enter the pieces as a
 * whole number." (Same for the mm cut length: it rounds to whole mm.)
 */
function BigNumberField({
  id,
  inputRef,
  label,
  value,
  onChange,
  onKeyDown,
  suffix,
  error,
  enterKeyHint,
}: {
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  value: string;
  onChange(v: string): void;
  onKeyDown?(e: KeyboardEvent<HTMLInputElement>): void;
  suffix: string;
  error?: string;
  enterKeyHint?: "next" | "done";
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-semibold leading-5">
        {label}
      </label>
      <NumberInput
        id={id}
        ref={inputRef}
        value={value}
        onValueChange={onChange}
        onKeyDown={onKeyDown}
        suffix={suffix}
        enterKeyHint={enterKeyHint}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-16 text-[28px] font-semibold tracking-[-0.01em] pointer-coarse:h-16"
      />
      {error ? (
        <p id={errorId} className="m-0 flex items-start gap-1.5 text-[13px] font-medium leading-5 text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The card's one loud element: kg/12ft as it is typed, the colour IS the
 * verdict (green in range, amber outside it) and the word says it too.
 * Quiet until both weight and pieces read as numbers. Not a live region:
 * the verdict is announced once, when the bundle is saved.
 */
function LiveReadout({
  k,
  verdict,
  rangeState,
  die,
  className,
}: {
  k: number | null;
  verdict: "in" | "below" | "above" | null;
  rangeState: RangeState;
  die: DieOption | null;
  className?: string;
}) {
  const { t } = useT();
  const verdictWord = useVerdictWord();
  const range = die
    ? t("pack.new.liveRange", { min: formatRangeKg(die.weightMinG), max: formatRangeKg(die.weightMaxG) })
    : null;
  const tone = k === null ? "idle" : verdict === "in" ? "green" : verdict ? "amber" : "neutral";
  const Icon = verdict === "in" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[14px] font-semibold leading-5">{t("units.kgPer12ft")}</span>
      <div
        data-slot="live-k12"
        data-tone={tone}
        className={cn(
          "flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-input px-4 py-2 transition-colors duration-[var(--dur-base)]",
          tone === "idle" && "bg-surface-sunken text-muted-foreground",
          tone === "neutral" && "bg-surface-sunken text-foreground",
          tone === "green" &&
            "bg-[linear-gradient(160deg,var(--tone-green-from),var(--tone-green-to))] text-tone-green-on shadow-block",
          tone === "amber" &&
            "bg-[linear-gradient(160deg,var(--tone-amber-from),var(--tone-amber-to))] text-tone-amber-on shadow-block",
        )}
      >
        {k === null ? (
          <span className="text-[13px] leading-5 font-medium">{t("pack.new.liveIncomplete")}</span>
        ) : (
          <>
            <span data-no-truncate="" className="font-mono text-[28px] font-semibold tracking-[-0.02em] tabular-nums">
              {formatK12(k)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[14px] font-bold">
              {verdict ? <Icon aria-hidden="true" strokeWidth={2} className="size-[18px]" /> : null}
              {verdictWord(verdict, rangeState)}
            </span>
          </>
        )}
      </div>
      {range ? (
        <span className="text-[13px] leading-5 font-medium text-muted-foreground tabular-nums">{range}</span>
      ) : null}
    </div>
  );
}

function OverrideLength({
  unit,
  value,
  onChange,
  error,
  uid,
}: {
  unit: LengthUnit;
  value: { mm: string; feet: string; inches: string };
  onChange(v: { mm: string; feet: string; inches: string }): void;
  error?: string;
  uid: string;
}) {
  const { t } = useT();
  const errorId = `${uid}-len-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined} className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[14px] font-semibold leading-5">{t("pack.new.lengthForBundle")}</legend>
      {unit === "inch" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${uid}-len-ft`} className="text-[13px] font-medium text-muted-foreground">
              {t("pack.new.cutLengthFeet")}
            </label>
            <NumberInput
              id={`${uid}-len-ft`}
              value={value.feet}
              onValueChange={(feet) => onChange({ ...value, feet })}
              suffix={t("units.ft")}
              aria-invalid={error ? true : undefined}
              className="h-12"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${uid}-len-in`} className="text-[13px] font-medium text-muted-foreground">
              {t("pack.new.cutLengthInches")}
            </label>
            <NumberInput
              id={`${uid}-len-in`}
              value={value.inches}
              onValueChange={(inches) => onChange({ ...value, inches })}
              suffix={t("units.inch")}
              aria-invalid={error ? true : undefined}
              className="h-12"
            />
          </div>
        </div>
      ) : (
        <NumberInput
          aria-label={t("pack.new.cutLengthMm")}
          value={value.mm}
          onValueChange={(mm) => onChange({ ...value, mm })}
          suffix={t("units.mm")}
          aria-invalid={error ? true : undefined}
          className="h-12"
        />
      )}
      {error ? (
        <p id={errorId} className="m-0 flex items-start gap-1.5 text-[13px] font-medium text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function SavedRow({
  index,
  bundle,
  unit,
  defaultLength,
  die,
  rangeState,
  editing,
  popped,
  onEdit,
}: {
  index: number;
  bundle: DraftBundle;
  unit: LengthUnit;
  defaultLength: number;
  die: DieOption | null;
  rangeState: RangeState;
  editing: boolean;
  popped: boolean;
  onEdit(): void;
}) {
  const { t } = useT();
  const lengthMm = bundle.lengthMm ?? defaultLength;
  const { k, verdict } = bundleRange({ ...bundle, lengthMm }, die);
  return (
    <button
      type="button"
      onClick={onEdit}
      data-slot="saved-bundle"
      className={cn(
        "animate-press grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-card border bg-card px-3 py-2 text-left",
        "transition-[background-color,border-color,scale] duration-[var(--dur-fast)] hover:bg-surface-sunken/60",
        editing ? "border-foreground" : "border-border",
        popped && "animate-pop",
      )}
    >
      <span className="sr-only">{t("pack.new.editBundleN", { n: index + 1 })}</span>
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-full bg-surface-sunken font-mono text-[13px] font-semibold tabular-nums"
      >
        {index + 1}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[15px]">
        <Measure value={formatKg(gToKg(bundle.weightG))} unit={t("units.kg")} className="font-semibold" />
        <Measure value={String(bundle.pieces)} unit={t("units.pcs")} />
        <span className="font-mono text-[14px] whitespace-nowrap">{formatLength(lengthMm, unit)}</span>
        {bundle.po !== undefined ? (
          <span className="text-[13px] whitespace-nowrap text-muted-foreground">
            {t("pack.new.poValue", { po: bundle.po })}
          </span>
        ) : null}
        {k !== null ? <Measure value={formatK12(k)} unit={t("units.kgPer12ft")} className="text-[14px]" /> : null}
      </span>
      <span className="flex items-center gap-2">
        <RangeChip verdict={verdict} state={rangeState} />
        <Pencil aria-hidden="true" strokeWidth={2} className="hidden size-4 text-muted-foreground sm:block" />
      </span>
    </button>
  );
}

function SessionStrip({
  draft,
  unit,
  die,
  dieLoading,
  yardCode,
  onChange,
}: {
  draft: PackDraft;
  unit: LengthUnit;
  die: DieOption | null;
  dieLoading: boolean;
  yardCode: string | null;
  onChange(): void;
}) {
  const { t } = useT();
  return (
    <div
      data-slot="session-strip"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card bg-surface-sunken px-4 py-2.5"
    >
      <dl className="m-0 flex min-w-0 flex-1 flex-wrap items-baseline gap-x-5 gap-y-1">
        <div className="flex items-baseline gap-2">
          <dt className="text-[13px] font-medium text-muted-foreground">{t("pack.new.chosenDie")}</dt>
          <dd className="m-0 font-mono text-[15px] font-semibold">
            {dieLoading ? <Skeleton className="inline-block h-4 w-16 align-middle" /> : (die?.sectionCode ?? "")}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-[13px] font-medium text-muted-foreground">{t("pack.new.cutLength")}</dt>
          <dd className="m-0 font-mono text-[15px] font-semibold whitespace-nowrap">
            {formatLength(draft.defaults.lengthMm, unit)}
          </dd>
        </div>
        {yardCode ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-[13px] font-medium text-muted-foreground">{t("pack.new.yard")}</dt>
            <dd className="m-0 font-mono text-[15px] font-semibold" data-testid="session-yard">
              {yardCode}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline gap-2">
          <dt className="text-[13px] font-medium text-muted-foreground">{t("pack.new.po")}</dt>
          <dd
            className={cn("m-0 text-[15px] font-semibold", draft.defaults.po ? "font-mono" : "text-muted-foreground")}
          >
            {draft.defaults.po || t("pack.new.noPo")}
          </dd>
        </div>
      </dl>
      <Button variant="ghost" onClick={onChange} className="-mr-2">
        {t("pack.new.change")}
      </Button>
    </div>
  );
}
