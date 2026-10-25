import { lengthFromInput, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { usePrefersReducedMotion } from "@orrn/ui/components/motion";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertCircle, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { dieListView, recentDieIds, type DieOption } from "./die-options";
import { chooseYard, lengthToInput } from "./pack-math";
import { PackBar, formatRangeKg } from "./pack-ui";
import type { PackDraft } from "./use-pack-draft";
import { DEFAULT_SOURCE, type SourceChoice } from "./source-gate";
import { SourceExtras, useSourceGate } from "./source-extras";
import { readLastYard, type YardState } from "./use-yards";
import { YardPicker } from "./yard-picker";

export type { DieOption };

const SEARCH_DEBOUNCE_MS = 200;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Step 1: the session's die, then its defaults (cut length once for the whole
 * session, the yard the bundles go to once the company has yards, optional
 * PO). Dies are a searchable list of big rows (recent
 * first, archived hidden) rather than a dropdown, so a gloved thumb can pick
 * one. Keyboard: type, then Enter picks a single match, or arrow down into
 * the rows; after a pick focus moves to the cut length.
 */
export function DieStep({
  draft,
  update,
  unit,
  yards,
  settings,
  onNext,
}: {
  draft: PackDraft;
  update(fn: (d: PackDraft) => PackDraft): void;
  unit: LengthUnit;
  yards: YardState;
  settings: unknown;
  onNext(): void;
}) {
  const { t } = useT();
  const [picking, setPicking] = useState(draft.dieId === null);
  const [dieError, setDieError] = useState<string | undefined>();
  // The row just tapped, shown at once while `die.get` loads.
  const [picked, setPicked] = useState<DieOption | null>(null);
  const firstLengthRef = useRef<HTMLInputElement | null>(null);
  const focusLengthNext = useRef(false);

  const chosen = useQuery({
    ...trpc.die.get.queryOptions({ id: draft.dieId ?? "" }),
    enabled: draft.dieId !== null,
  });

  useEffect(() => {
    if (!picking && focusLengthNext.current) {
      focusLengthNext.current = false;
      firstLengthRef.current?.focus();
    }
  }, [picking]);

  const choose = (die: DieOption) => {
    setPicked(die);
    // Another section: the copy and order chosen for the last one do not apply.
    update((d) => {
      if (d.dieId === die.id) return d;
      const { dieInstanceId: _copy, salesOrderLineId: _line, approvalId: _approval, ...defaults } = d.defaults;
      return { ...d, dieId: die.id, defaults };
    });
    setDieError(undefined);
    focusLengthNext.current = true;
    setPicking(false);
  };

  const showPicker = picking || draft.dieId === null;
  const fallback = picked && picked.id === draft.dieId ? picked : null;
  const shownDie = (chosen.data as DieOption | undefined) ?? fallback;

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="pack-die-heading" className="flex flex-col gap-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h3 id="pack-die-heading" className="m-0 text-[15px] font-semibold">
            {t("pack.new.chosenDie")}
          </h3>
          {showPicker && draft.dieId !== null ? (
            <Button variant="ghost" onClick={() => setPicking(false)} className="-mr-2">
              {t("common.cancel")}
            </Button>
          ) : null}
        </div>
        {showPicker ? (
          <DiePicker onChoose={choose} error={dieError} />
        ) : (
          <ChosenDie
            die={shownDie}
            loading={!shownDie && chosen.isPending}
            failed={!shownDie && chosen.isError}
            onChange={() => setPicking(true)}
          />
        )}
      </section>

      {/* Cut length and PO wait until a die is chosen (kept mounted so typed values survive "Change die"). */}
      <DefaultsForm
        hidden={showPicker}
        summary={
          shownDie ? (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[17px] font-semibold">{shownDie.sectionCode}</span>
              <span className="text-[13px] font-semibold text-muted-foreground">{shownDie.series}</span>
            </span>
          ) : undefined
        }
        draft={draft}
        unit={unit}
        yards={yards}
        settings={settings}
        firstInputRef={firstLengthRef}
        onSubmit={(defaults) => {
          if (draft.dieId === null) {
            setDieError(t("pack.new.dieRequired"));
            setPicking(true);
            return false;
          }
          update((d) => ({ ...d, defaults, step: 1 }));
          onNext();
          return true;
        }}
      />
    </div>
  );
}

function DiePicker({ onChoose, error }: { onChoose(die: DieOption): void; error?: string }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const typed = text.trim();
  const debounced = useDebounced(typed, SEARCH_DEBOUNCE_MS);
  // Enter does not wait for the debounce: the typed text becomes the query at once.
  const [flushed, setFlushed] = useState<string | null>(null);
  const [enterWanted, setEnterWanted] = useState(false);
  const query = flushed !== null && flushed === typed ? flushed : debounced;
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  // Active dies only, so archived ones take no places in the 100.
  const all = useQuery(trpc.die.list.queryOptions({ status: "active", limit: 100, offset: 0 }));
  const searched = useQuery({
    ...trpc.die.list.queryOptions({ search: query, status: "active", limit: 100, offset: 0 }),
    enabled: query !== "",
  });
  const recentSessions = useQuery(trpc.bundle.listGroups.queryOptions({ limit: 30, offset: 0 }));
  // Recent dies are looked up by id, so a die outside the first 100 still leads.
  const recentLookups = useQueries({
    queries: recentDieIds(recentSessions.data?.items).map((id) => trpc.die.get.queryOptions({ id })),
  });

  const view = useMemo(
    () =>
      dieListView({
        query,
        page: all.data,
        searched: searched.data,
        recent: recentLookups.map((q) => q.data as DieOption | undefined),
      }),
    [query, all.data, searched.data, recentLookups],
  );
  const { recent, rest, more } = view;

  const loading = query !== "" ? searched.isPending : all.isPending;
  // A failed background refresh keeps the dies already listed.
  const failed = query !== "" ? searched.isError && !searched.data : all.isError && !all.data;
  const retry = () => void (query !== "" ? searched.refetch() : all.refetch());
  const options = [...recent, ...rest];

  // Enter pressed inside the debounce: pick the single match once its results arrive.
  const resultsReady = query !== "" && query === typed && searched.isSuccess && !searched.isPlaceholderData;
  useEffect(() => {
    if (!enterWanted || !resultsReady) return;
    setEnterWanted(false);
    if (options.length === 1) onChoose(options[0]!);
  }, [enterWanted, resultsReady, options, onChoose]);

  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-die]") ?? []);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (typed === "") return;
      if (resultsReady) {
        if (options.length === 1) onChoose(options[0]!);
      } else {
        setFlushed(typed);
        setEnterWanted(true);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      rows()[0]?.focus();
    }
  };

  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = rows();
    const i = buttons.indexOf(e.currentTarget);
    const next = e.key === "ArrowDown" ? buttons[i + 1] : buttons[i - 1];
    if (next) next.focus();
    else if (e.key === "ArrowUp") document.getElementById(inputId)?.focus();
  };

  const noDiesAtAll = !loading && !failed && query === "" && options.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={inputId} className="-mb-1.5 text-[13px] font-medium text-muted-foreground">
        {t("pack.new.dieSearch")}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
        />
        <TextInput
          id={inputId}
          type="search"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={onSearchKey}
          autoComplete="off"
          enterKeyHint="search"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="h-12 pr-11 pl-10 text-[16px] [&::-webkit-search-cancel-button]:appearance-none"
        />
        {text ? (
          <button
            type="button"
            aria-label={t("pack.clearSearch")}
            onClick={() => {
              setText("");
              document.getElementById(inputId)?.focus();
            }}
            className="absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-foreground"
          >
            <X aria-hidden="true" className="size-4" strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="m-0 flex items-start gap-1.5 text-[13px] font-medium text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          {error}
        </p>
      ) : null}

      {failed ? (
        <div
          role="alert"
          className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink"
        >
          <p className="m-0 min-w-0 flex-1 basis-[14rem]">{t("pack.new.diesFailed")}</p>
          <Button variant="secondary" onClick={retry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : loading ? (
        <ul aria-hidden="true" className="m-0 flex list-none flex-col gap-2 p-0">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-[68px] w-full rounded-card" />
            </li>
          ))}
        </ul>
      ) : noDiesAtAll ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("pack.new.noDiesYet")}
            action={
              <Can do="die.create">
                <Button asChild variant="secondary">
                  <UiLink to="/dies">{t("pack.new.addDie")}</UiLink>
                </Button>
              </Can>
            }
          />
        </div>
      ) : options.length === 0 ? (
        <p role="status" className="m-0 rounded-card bg-surface-sunken px-4 py-3 text-[14px] text-muted-foreground">
          {t("pack.new.noDies")}
        </p>
      ) : (
        <ul ref={listRef} className="m-0 flex list-none flex-col gap-4 p-0">
          {recent.length > 0 ? (
            <DieGroup label={t("pack.new.recentDies")} dies={recent} onChoose={onChoose} onKeyDown={onRowKey} />
          ) : null}
          {rest.length > 0 ? (
            <DieGroup
              label={recent.length > 0 ? t("pack.new.allDies") : undefined}
              dies={rest}
              onChoose={onChoose}
              onKeyDown={onRowKey}
            />
          ) : null}
          {more ? (
            <li>
              <p role="status" className="m-0 text-[13px] font-medium text-muted-foreground">
                {t("pack.new.diesShowing", {
                  shown: more.shown.toLocaleString("en-IN"),
                  total: more.total.toLocaleString("en-IN"),
                })}
              </p>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function DieGroup({
  label,
  dies,
  onChoose,
  onKeyDown,
}: {
  label?: string;
  dies: DieOption[];
  onChoose(d: DieOption): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}) {
  const labelId = useId();
  return (
    <li className="flex flex-col gap-2">
      {label ? (
        <p id={labelId} className="m-0 text-[13px] font-semibold text-muted-foreground">
          {label}
        </p>
      ) : null}
      <ul aria-labelledby={label ? labelId : undefined} className="m-0 flex list-none flex-col gap-2 p-0">
        {dies.map((d) => (
          <li key={d.id}>
            <DieRow die={d} onChoose={() => onChoose(d)} onKeyDown={onKeyDown} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function DieRow({
  die,
  onChoose,
  onKeyDown,
}: {
  die: DieOption;
  onChoose(): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      data-die={die.id}
      onClick={onChoose}
      onKeyDown={onKeyDown}
      className={cn(
        "animate-press grid min-h-[68px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 rounded-card border border-border bg-card px-4 py-3 text-left shadow-sm",
        "transition-[background-color,border-color,scale] duration-[var(--dur-fast)] hover:border-control/50 hover:bg-surface-sunken/60",
      )}
    >
      <span className="col-start-1 flex min-w-0 flex-wrap items-baseline gap-x-2.5">
        <span className="font-mono text-[17px] font-semibold tracking-[-0.01em] text-foreground">
          {die.sectionCode}
        </span>
        <span className="text-[13px] font-semibold text-muted-foreground">{die.series}</span>
      </span>
      <span className="col-start-2 row-span-2 row-start-1 hidden text-right text-[13px] font-medium text-muted-foreground tabular-nums sm:block">
        {t("pack.new.dieRange", { min: formatRangeKg(die.weightMinG), max: formatRangeKg(die.weightMaxG) })}
      </span>
      {die.name ? <span className="col-start-1 min-w-0 text-[14px] leading-5 break-words text-foreground">{die.name}</span> : null}
      <span className="col-span-2 text-[13px] font-medium text-muted-foreground tabular-nums sm:hidden">
        {t("pack.new.dieRange", { min: formatRangeKg(die.weightMinG), max: formatRangeKg(die.weightMaxG) })}
      </span>
    </button>
  );
}

function ChosenDie({
  die,
  loading,
  failed,
  onChange,
}: {
  die: DieOption | null;
  loading: boolean;
  failed: boolean;
  onChange(): void;
}) {
  const { t } = useT();
  return (
    <div
      data-slot="chosen-die"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-border bg-card px-4 py-3.5 shadow-sm"
    >
      <div className="flex min-w-0 flex-1 basis-[14rem] flex-col gap-0.5">
        {loading ? (
          <>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1 h-4 w-48" />
          </>
        ) : failed || !die ? (
          <p className="m-0 text-[14px] font-medium text-destructive">{t("pack.new.diesFailed")}</p>
        ) : (
          <>
            <p className="m-0 flex flex-wrap items-baseline gap-x-2.5">
              <span className="font-mono text-[19px] font-semibold tracking-[-0.01em]">{die.sectionCode}</span>
              <span className="text-[13px] font-semibold text-muted-foreground">{die.series}</span>
            </p>
            {die.name ? <p className="m-0 text-[14px] break-words">{die.name}</p> : null}
            <p className="m-0 text-[13px] font-medium text-muted-foreground tabular-nums">
              {t("pack.new.dieRange", { min: formatRangeKg(die.weightMinG), max: formatRangeKg(die.weightMaxG) })}
            </p>
          </>
        )}
      </div>
      <Button variant="secondary" onClick={onChange}>
        {t("pack.new.changeDie")}
      </Button>
    </div>
  );
}

function DefaultsForm({
  hidden,
  summary,
  draft,
  unit,
  yards,
  settings,
  firstInputRef,
  onSubmit,
}: {
  hidden: boolean;
  summary?: ReactNode;
  draft: PackDraft;
  unit: LengthUnit;
  yards: YardState;
  settings: unknown;
  firstInputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit(defaults: PackDraft["defaults"]): boolean;
}) {
  const { t } = useT();
  const initial = lengthToInput(draft.defaults.lengthMm, unit);
  const [mm, setMm] = useState(initial.mm);
  const [feet, setFeet] = useState(initial.feet);
  const [inches, setInches] = useState(initial.inches);
  const [po, setPo] = useState(draft.defaults.po ?? "");
  const [lengthError, setLengthError] = useState<string | undefined>();
  // The yard tapped here; until then the draft's yard, else this device's last yard (chooseYard).
  const [pickedYard, setPickedYard] = useState<string | undefined>();
  const [lastYard] = useState(() => readLastYard(draft.companyId));
  const [yardError, setYardError] = useState<string | undefined>();
  // Source choices (order, copy, cast, logo): kept with the draft so a reload keeps them.
  const [choice, setChoice] = useState<SourceChoice>(() => ({
    ...DEFAULT_SOURCE,
    ...(draft.defaults.salesOrderLineId ? { salesOrderLineId: draft.defaults.salesOrderLineId } : {}),
    ...(draft.defaults.dieInstanceId ? { dieInstanceId: draft.defaults.dieInstanceId } : {}),
    ...(draft.defaults.castId ? { castId: draft.defaults.castId } : {}),
    ...(draft.defaults.overridePin ? { overridePin: true } : {}),
    showLogo: draft.defaults.showLogo !== false,
  }));
  const [showSourceErrors, setShowSourceErrors] = useState(false);
  const gate = useSourceGate(draft.dieId, choice, settings);
  // A different section was picked: the order, copy and cast of the last one do not apply.
  const lastDie = useRef(draft.dieId);
  useEffect(() => {
    if (lastDie.current === draft.dieId) return;
    const was = lastDie.current;
    lastDie.current = draft.dieId;
    if (was !== null) setChoice((c) => ({ showLogo: c.showLogo }));
    setShowSourceErrors(false);
  }, [draft.dieId]);
  const yardRef = useRef<HTMLInputElement | null>(null);
  const inchesRef = useRef<HTMLInputElement | null>(null);
  const yardId = chooseYard({
    current: pickedYard ?? draft.defaults.locationId,
    lastUsed: lastYard,
    yards: yards.yards,
  });
  const legendId = useId();
  const errorId = `${legendId}-error`;
  const hintId = `${legendId}-hint`;
  const reduced = usePrefersReducedMotion();

  /**
   * Focus the yard tiles and bring the whole question, its error included,
   * into view above the sticky bar (focusing a tile alone can leave the error
   * line under the bar on a phone).
   */
  const focusYard = () => {
    const tile = yardRef.current;
    tile?.focus({ preventScroll: true });
    requestAnimationFrame(() =>
      tile?.closest("fieldset")?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }),
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const lengthMm = lengthFromInput({ unit, mm, feet, inches });
    if (lengthMm === null) {
      setLengthError(t("pack.new.cutLengthRequired"));
      firstInputRef.current?.focus();
      return;
    }
    setLengthError(undefined);
    // Yards still loading or not loaded: the server would refuse a session without its yard.
    if (yards.loading) return;
    if (yards.failed) {
      yards.retry();
      return;
    }
    if (yards.yards.length > 0 && !yardId) {
      setYardError(t("pack.new.yardRequired"));
      focusYard();
      return;
    }
    setYardError(undefined);
    // The plant's rules (cast) and an owned die stop the packer here, in plain words, not at Save.
    if (gate.blockers.length > 0) {
      setShowSourceErrors(true);
      return;
    }
    const trimmed = po.trim();
    onSubmit({
      lengthMm,
      ...(trimmed ? { po: trimmed } : {}),
      ...(yardId ? { locationId: yardId } : {}),
      ...(choice.dieInstanceId ? { dieInstanceId: choice.dieInstanceId } : {}),
      ...(choice.castId ? { castId: choice.castId } : {}),
      ...(choice.salesOrderLineId ? { salesOrderLineId: choice.salesOrderLineId } : {}),
      ...(choice.salesOrderLineId && choice.overridePin ? { overridePin: true } : {}),
      ...(choice.showLogo ? {} : { showLogo: false }),
      // A grant the packer got earlier for this copy stays with the draft.
      ...(draft.defaults.approvalId ? { approvalId: draft.defaults.approvalId } : {}),
    });
  };

  const describedBy = [hintId, lengthError ? errorId : null].filter(Boolean).join(" ");

  return (
    <form noValidate onSubmit={submit} hidden={hidden} className="flex flex-col gap-4 [&[hidden]]:hidden">
      <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 shadow-sm sm:p-5">
        {unit === "inch" ? (
          <fieldset aria-describedby={describedBy} className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <legend id={legendId} className="mb-1.5 p-0 text-[14px] font-semibold leading-5">
              {t("pack.new.cutLength")}
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:max-w-[360px]">
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${legendId}-ft`} className="text-[13px] font-medium text-muted-foreground">
                  {t("pack.new.cutLengthFeet")}
                </label>
                <NumberInput
                  id={`${legendId}-ft`}
                  ref={firstInputRef}
                  value={feet}
                  onValueChange={setFeet}
                  suffix={t("units.ft")}
                  enterKeyHint="next"
                  onKeyDown={(e) => {
                    // Enter moves on to Inches instead of saving the session at whole feet.
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    inchesRef.current?.focus();
                  }}
                  aria-invalid={lengthError ? true : undefined}
                  aria-describedby={describedBy}
                  className="h-14 text-[22px]"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${legendId}-in`} className="text-[13px] font-medium text-muted-foreground">
                  {t("pack.new.cutLengthInches")}
                </label>
                <NumberInput
                  id={`${legendId}-in`}
                  ref={inchesRef}
                  value={inches}
                  onValueChange={setInches}
                  suffix={t("units.inch")}
                  enterKeyHint="go"
                  aria-invalid={lengthError ? true : undefined}
                  aria-describedby={describedBy}
                  className="h-14 text-[22px]"
                />
              </div>
            </div>
            <p id={hintId} className="m-0 text-[13px] leading-5 text-muted-foreground">
              {t("pack.new.cutLengthHintInch")}
            </p>
            {lengthError ? (
              <p id={errorId} className="m-0 flex items-start gap-1.5 text-[13px] font-medium text-destructive">
                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                {lengthError}
              </p>
            ) : null}
          </fieldset>
        ) : (
          <Field
            label={t("pack.new.cutLengthMm")}
            hint={t("pack.new.cutLengthHintMm")}
            error={lengthError}
            className="sm:max-w-[240px]"
          >
            <NumberInput
              ref={firstInputRef}
              value={mm}
              onValueChange={setMm}
              suffix={t("units.mm")}
              enterKeyHint="go"
              className="h-14 text-[22px]"
            />
          </Field>
        )}

        {yards.loading || yards.failed || yards.yards.length > 0 ? (
          <YardPicker
            yards={yards.yards}
            value={yardId}
            onChange={(id) => {
              setPickedYard(id);
              setYardError(undefined);
            }}
            loading={yards.loading}
            failed={yards.failed}
            onRetry={yards.retry}
            error={
              yardError ??
              // Bundles typed before the yard was asked (or its yard was retired): say why we are back here.
              (draft.bundles.length > 0 && !yards.loading && yards.yards.length > 0 && !yardId
                ? t("pack.new.yardRequired")
                : undefined)
            }
            firstRef={yardRef}
          />
        ) : null}

        <Field label={t("pack.new.po")} hint={t("common.optional")} className="sm:max-w-[360px]">
          <TextInput
            value={po}
            onChange={(e) => setPo(e.currentTarget.value)}
            maxLength={500}
            autoComplete="off"
            enterKeyHint="go"
            className="h-12 font-mono text-[16px]"
          />
        </Field>

        {draft.dieId ? (
          <SourceExtras
            choice={choice}
            onChange={(next) => {
              setChoice(next);
              setShowSourceErrors(false);
            }}
            gate={gate}
            showErrors={showSourceErrors}
          />
        ) : null}

        {showSourceErrors && gate.blockers.length > 0 ? (
          <p role="alert" className="m-0 flex items-start gap-1.5 text-[13px] font-medium text-destructive">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            {t("pack.source.cannotContinue")}
          </p>
        ) : null}

        <p className="m-0 max-w-[60ch] text-[14px] leading-6 text-muted-foreground">{t("pack.new.defaultsHint")}</p>
      </div>

      <PackBar summary={summary}>
        <Button type="submit" size="lg" className="sm:min-w-[180px]">
          {t("common.next")}
        </Button>
      </PackBar>
    </form>
  );
}
