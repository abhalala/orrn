import { formatKg, formatKgTotal, formatLength, gToKg, lengthFromInput, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { NumberInput, TextInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Pencil, Scale } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { DieOption } from "./die-step";
import {
  bandText,
  driftChipTone,
  driftText,
  kg12Text,
  positionKey,
  positionTone,
  type LineVerdict,
} from "./line-preview";
import { lengthToInput, parsePieces, parseWeightG } from "./pack-math";
import { Measure, PackBar, formatRangeKg, type RangeState } from "./pack-ui";
import { RejectsPanel } from "./rejects-panel";
import {
  gramsToFieldText,
  gramsToKgText,
  typedWeightNeedsReason,
  weightProvenance,
  type ScaleView,
} from "./scale-view";
import { useLinePreview, useLinesPreview, useScale } from "./use-pack-server";
import {
  MAX_BUNDLES,
  addBundle,
  addReject,
  removeBundle,
  removeReject,
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
  // The scale (FP-PK-02): the steady weight fills the field; typing over it, or typing with the scale
  // silent, asks a reason. `filledFrom` is the steady grams the field was filled with.
  const scale = useScale(true);
  const [filledFrom, setFilledFrom] = useState<number | null>(null);
  const [armed, setArmed] = useState(true);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

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
    setFilledFrom(null);
    setReason("");
    setReasonError(false);
  };

  // A steady weight fills an empty weight field (or one still holding the last scale fill). After a
  // bundle is saved it waits for the scale to settle on something new, so the same bundle is never
  // filled twice.
  const stable = scale.view.state === "stable" ? scale.view.grams : null;
  const latest = useRef({ weight, filledFrom });
  latest.current = { weight, filledFrom };
  useEffect(() => {
    if (stable === null) {
      setArmed(true);
      return;
    }
    if (editIndex !== null || !armed) return;
    const { weight: w, filledFrom: f } = latest.current;
    const holdsScaleFill = f !== null && w === gramsToFieldText(f);
    if (w.trim() !== "" && !holdsScaleFill) return;
    setWeight(gramsToFieldText(stable));
    setFilledFrom(stable);
    setErrors((x) => (x.weight ? { ...x, weight: undefined } : x));
  }, [stable, armed, editIndex]);

  const overrideLengthTyped = override && (len.mm.trim() || len.feet.trim() || len.inches.trim());
  const overrideLength = overrideLengthTyped ? lengthFromInput({ unit, ...len }) : null;
  const liveLength = overrideLength ?? defaultLength;
  const liveWeightG = parseWeightG(weight);
  const livePieces = parsePieces(pieces);
  // The verdict is the server's (kg/12 ft, band position, drift): nothing is worked out on this screen.
  const live = useLinePreview({
    dieId: draft.dieId,
    dieInstanceId: draft.defaults.dieInstanceId,
    lengthMm: liveLength,
    weightG: liveWeightG,
    pieces: livePieces,
  });
  const viewState = scale.view;
  const typedOverScale = liveWeightG !== null && !(filledFrom !== null && filledFrom === liveWeightG);
  const askReason = typedWeightNeedsReason(viewState) && typedOverScale;
  // Verdicts for the saved bundles, one call.
  const saved = useLinesPreview(
    draft.dieId,
    draft.defaults.dieInstanceId,
    draft.bundles.map((b) => ({ lengthMm: b.lengthMm ?? defaultLength, weightG: b.weightG, pcs: b.pieces })),
  );

  /** Validates the card; returns the bundle or null (errors shown, focus on the first bad field). */
  const readCard = (): DraftBundle | null => {
    const weightG = parseWeightG(weight);
    const pcs = parsePieces(pieces);
    const next: typeof errors = {};
    if (weightG === null) next.weight = t("pack.new.weightRequired");
    if (pcs === null) next.pieces = t("pack.new.piecesRequired");
    if (overrideLengthTyped && overrideLength === null) next.length = t("pack.new.cutLengthRequired");
    // A typed weight with a scale connected says why (D12); the server asks again at save.
    const typedNeedsWhy = weightG !== null && typedWeightNeedsReason(viewState) && !(filledFrom !== null && filledFrom === weightG);
    if (typedNeedsWhy && !reason.trim()) {
      setReasonError(true);
      if (!next.weight && !next.pieces && !next.length) reasonRef.current?.focus();
    } else setReasonError(false);
    setErrors(next);
    if (next.weight) weightRef.current?.focus();
    else if (next.pieces) piecesRef.current?.focus();
    if (weightG === null || pcs === null || next.length || (typedNeedsWhy && !reason.trim())) return null;
    const ownPo = override ? po.trim() : "";
    // Provenance is sent only when a scale is connected; without one every weight is typed.
    const prov = typedWeightNeedsReason(viewState)
      ? weightProvenance({ weightG, filledFromG: filledFrom, lastStableG: scale.lastStableG })
      : null;
    return {
      weightG,
      pieces: pcs,
      ...(overrideLength !== null && overrideLength !== defaultLength ? { lengthMm: overrideLength } : {}),
      ...(ownPo && ownPo !== (draft.defaults.po ?? "") ? { po: ownPo } : {}),
      ...(prov ? { weightSource: prov.weightSource, ...(prov.scaleReadingG ? { scaleReadingG: prov.scaleReadingG } : {}) } : {}),
      ...(prov?.weightSource === "manual" && reason.trim() ? { weightOverrideReason: reason.trim() } : {}),
    };
  };

  const save = (): boolean => {
    const b = readCard();
    if (!b) return false;
    if (editIndex !== null) {
      update((d) => replaceBundle(d, editIndex, b));
      announce(t("pack.new.bundleUpdated", { n: editIndex + 1 }));
      setPopped(editIndex);
    } else {
      const n = draft.bundles.length + 1;
      update((d) => addBundle(d, b));
      // The saved sentence names the server's verdict for this bundle when it is on screen.
      const word = live.verdict && positionKey(live.verdict.position) ? t(positionKey(live.verdict.position)!) : t("status.range.noRange");
      announce(t("pack.new.bundleSaved", { n, kg: formatKg(gToKg(b.weightG)), pieces: b.pieces, status: word }));
      setPopped(n - 1);
    }
    resetCard();
    // The bundle stays on the scale for a moment: wait for the next steady weight.
    setArmed(false);
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
    setFilledFrom(b.weightSource === "scale" ? (b.scaleReadingG ?? null) : null);
    setReason(b.weightOverrideReason ?? "");
    setReasonError(false);
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
  const rejectPcs = (draft.rejects ?? []).reduce((s, r) => s + r.pcs, 0);
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
                  verdict={saved.verdicts[i] ?? null}
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
              verdict={live.verdict}
              loading={live.loading}
              rangeState={rangeState}
              die={die}
              copyCode={null}
              className="col-span-2 md:col-span-1"
            />
          </div>

          <ScaleStrip
            view={viewState}
            weightText={weight}
            onUse={(grams) => {
              setWeight(gramsToFieldText(grams));
              setFilledFrom(grams);
              setErrors((x) => ({ ...x, weight: undefined }));
              setReasonError(false);
            }}
            filledFrom={filledFrom}
            typed={askReason}
            reason={reason}
            reasonError={reasonError}
            reasonRef={reasonRef}
            onReason={(v) => {
              setReason(v);
              if (v.trim()) setReasonError(false);
            }}
            uid={uid}
          />

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

      <RejectsPanel
        rejects={draft.rejects ?? []}
        onAdd={(r) => {
          update((d) => addReject(d, r));
          announce(t("pack.reject.added", { count: r.pcs }));
        }}
        onRemove={(i) => update((d) => removeReject(d, i))}
      />

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
              {rejectPcs > 0 ? <Measure value={rejectPcs.toLocaleString("en-IN")} unit={t("pack.reject.unit")} /> : null}
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
 * The card's one loud element: kg/12ft as it is typed, worked out by the server (`bundle.previewLine`).
 * The colour IS the band position (green in the die's band, amber outside) and the word says it too;
 * the drift chip is the percent against the band start. Quiet until weight and pieces read as
 * numbers. Not a live region: the verdict is announced once, when the bundle is saved.
 */
function LiveReadout({
  verdict,
  loading,
  rangeState,
  die,
  copyCode,
  className,
}: {
  verdict: LineVerdict | null;
  loading: boolean;
  rangeState: RangeState;
  die: DieOption | null;
  copyCode: string | null;
  className?: string;
}) {
  const { t } = useT();
  const key = verdict ? positionKey(verdict.position) : null;
  const tone = verdict === null ? "idle" : verdict.position === "in" ? "green" : verdict.position ? "amber" : "neutral";
  const Icon = verdict?.position === "in" ? CheckCircle2 : AlertTriangle;
  const chip = verdict ? driftChipTone(verdict.driftTone) : null;
  const drift = verdict ? driftText(verdict.driftPercentTenths) : null;
  // The copy's band when the bundle names a copy, else the section's; the die range text until the server answers.
  const range = verdict?.band
    ? t(verdict.band.source === "copy" ? "pack.new.liveBandCopy" : "pack.new.liveBand", { band: bandText(verdict.band) })
    : die
      ? t("pack.new.liveRange", { min: formatRangeKg(die.weightMinG), max: formatRangeKg(die.weightMaxG) })
      : null;
  void copyCode;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[14px] font-semibold leading-5">{t("units.kgPer12ft")}</span>
      <div
        data-slot="live-k12"
        data-tone={tone}
        data-loading={loading || undefined}
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
        {verdict === null ? (
          <span className="text-[13px] leading-5 font-medium">
            {rangeState === "failed" ? t("pack.new.rangeUnknown") : t("pack.new.liveIncomplete")}
          </span>
        ) : (
          <>
            <span data-no-truncate="" data-testid="live-k12-value" className="font-mono text-[28px] font-semibold tracking-[-0.02em] tabular-nums">
              {kg12Text(verdict.kgPer12ftMilli) ?? ""}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[14px] font-bold">
              {key ? <Icon aria-hidden="true" strokeWidth={2} className="size-[18px]" /> : null}
              {key ? t(key) : t("status.range.noRange")}
            </span>
          </>
        )}
      </div>
      {verdict && chip && drift ? (
        <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] leading-5 text-muted-foreground" data-slot="drift">
          <Chip tone={chip} data-testid="drift-chip" data-drift-tone={verdict.driftTone}>
            {t("pack.new.drift", { percent: drift })}
          </Chip>
          <span>{t("pack.new.driftBasis")}</span>
        </p>
      ) : null}
      {range ? (
        <span className="text-[13px] leading-5 font-medium text-muted-foreground tabular-nums">{range}</span>
      ) : null}
    </div>
  );
}

/**
 * The scale line under the weight: what the scale says, a button to take a steady weight, and (when
 * a scale is connected and the weight was typed) why it was typed.
 */
function ScaleStrip({
  view,
  weightText,
  onUse,
  filledFrom,
  typed,
  reason,
  reasonError,
  reasonRef,
  onReason,
  uid,
}: {
  view: ScaleView;
  weightText: string;
  onUse(grams: number): void;
  filledFrom: number | null;
  typed: boolean;
  reason: string;
  reasonError: boolean;
  reasonRef: React.RefObject<HTMLTextAreaElement | null>;
  onReason(v: string): void;
  uid: string;
}) {
  const { t } = useT();
  if (view.state === "off") return null;
  const usingScale = view.state === "stable" && filledFrom === view.grams && weightText === gramsToFieldText(view.grams);
  const chip =
    view.state === "stable" ? (
      <Chip tone="green" data-testid="scale-chip" data-scale="stable">
        {t("pack.scale.stable")} {gramsToKgText(view.grams)} {t("units.kg")}
      </Chip>
    ) : view.state === "waiting" ? (
      <Chip tone="amber" data-testid="scale-chip" data-scale="waiting">
        {t("pack.scale.waiting")}
      </Chip>
    ) : (
      <Chip tone="amber" data-testid="scale-chip" data-scale="silent">
        {t("pack.scale.stale")}
      </Chip>
    );
  const reasonId = `${uid}-why`;
  return (
    <div data-slot="scale-strip" className="flex flex-col gap-3 rounded-input bg-surface-sunken p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-2 text-[14px] font-semibold">
          <Scale aria-hidden="true" className="size-4" strokeWidth={2} />
          {t("pack.scale.title")}
          {view.simulated ? <span className="text-[12px] font-medium text-muted-foreground">{t("pack.scale.simulated")}</span> : null}
        </span>
        <span aria-live="polite">{chip}</span>
        {view.state === "stable" && !usingScale ? (
          <Button variant="secondary" onClick={() => onUse(view.grams)} data-testid="use-scale">
            {t("pack.scale.useScale")}
          </Button>
        ) : null}
        {usingScale ? <span className="text-[13px] text-muted-foreground">{t("pack.scale.fromScale")}</span> : null}
      </div>
      {typed ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={reasonId} className="text-[14px] font-semibold leading-5">
            {t("pack.scale.typedReason")}
          </label>
          <TextArea
            id={reasonId}
            ref={reasonRef}
            value={reason}
            onChangeText={onReason}
            rows={2}
            maxLength={500}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${reasonId}-error` : undefined}
            placeholder={t("pack.scale.typedReasonHint")}
          />
          {reasonError ? (
            <p id={`${reasonId}-error`} className="m-0 flex items-start gap-1.5 text-[13px] font-medium text-destructive">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
              {t("pack.scale.reasonRequired")}
            </p>
          ) : null}
        </div>
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
  verdict,
  editing,
  popped,
  onEdit,
}: {
  index: number;
  bundle: DraftBundle;
  unit: LengthUnit;
  defaultLength: number;
  verdict: LineVerdict | null;
  editing: boolean;
  popped: boolean;
  onEdit(): void;
}) {
  const { t } = useT();
  const lengthMm = bundle.lengthMm ?? defaultLength;
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
        {verdict?.kgPer12ftMilli != null ? (
          <Measure value={kg12Text(verdict.kgPer12ftMilli) ?? ""} unit={t("units.kgPer12ft")} className="text-[14px]" />
        ) : null}
        {bundle.weightSource === "manual" && bundle.weightOverrideReason ? (
          <span className="text-[13px] text-muted-foreground">{t("pack.scale.typed")}</span>
        ) : null}
      </span>
      <span className="flex items-center gap-2">
        <VerdictChip verdict={verdict} />
        <Pencil aria-hidden="true" strokeWidth={2} className="hidden size-4 text-muted-foreground sm:block" />
      </span>
    </button>
  );
}

/** The server's band position as a chip ("In range" / "Below range" / "Above range" / "No range set"). */
export function VerdictChip({ verdict, className }: { verdict: { position: LineVerdict["position"] } | null; className?: string }) {
  const { t } = useT();
  if (!verdict) return <Skeleton aria-hidden="true" className={cn("inline-block h-6 w-20 rounded-full", className)} />;
  const key = positionKey(verdict.position);
  return (
    <Chip tone={positionTone(verdict.position)} className={className} data-verdict={verdict.position ?? "none"}>
      {key ? t(key) : t("status.range.noRange")}
    </Chip>
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
