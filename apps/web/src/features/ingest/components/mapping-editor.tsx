import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";
import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import type { DateFormat, IngestTarget, Recipe } from "@orrn/ingest";

import {
  addMapping,
  assignField,
  columnEntries,
  initialColumnMap,
  initialLayoutName,
  mappingStatus,
  saveCheck,
  setColumnDateFormat,
  setColumnUnit,
  targetSelect,
  updateMapping,
  usePlantUnits,
  type CandidateDetail,
  type ColumnEntry,
  type ColumnMap,
  type MappingRow,
  type ProblemFocus,
  type SaveCheck,
} from "../lib";
import { ActionButton, ColumnHeaderCell, EvidencePanel, FieldSelect, PreviewCell, SampleCell, useSay } from "./review-bits";
import { ActionError, IngestBar } from "./shared";
import type { ReviewActions } from "./use-review-actions";

export type { MappingRow };

/** The mapping logic lives in `lib/recipe-builder`; these are kept so the screen's own tests keep their names. */
export { addMapping, updateMapping };

const blockOf = (candidate: CandidateDetail) => ({
  headers: candidate.block.headers,
  headerKey: candidate.block.headerKey,
  headerRow: candidate.block.headerRow,
  headerRows: candidate.block.headerRows,
});

type Act = Pick<ReviewActions, "saveShape" | "busy" | "pending" | "failed">;

/**
 * The mapping editor (work order 3.4, M9): one panel, one row per column of the file, in file order. The person says what
 * the table is, names the layout, and for each column what it goes into and in what unit, and sees what orrn would store
 * for the first sample. Every failed Save says why in one alert, focused, with a link to each problem (WCAG 3.3.1).
 */
export function MappingEditor({
  candidate,
  canSeePrices,
  act,
  onSaved,
  onCancel,
  targetRef,
  id,
}: {
  candidate: CandidateDetail;
  canSeePrices: boolean;
  act: Act;
  onSaved?: () => void;
  onCancel?: () => void;
  /** The first control, so the page can focus it when the person opens the editor. */
  targetRef?: Ref<HTMLSelectElement>;
  id?: string;
}) {
  const { t, words } = useSay();
  const plant = usePlantUnits();
  const wide = useMediaQuery(breakpoints.desktop);
  const block = useMemo(() => blockOf(candidate), [candidate]);
  const previous = candidate.recipe as Recipe | null;
  const chosen = targetSelect(candidate);
  const [target, setTarget] = useState<IngestTarget | null>(chosen.value === "" ? null : chosen.value);
  const [map, setMap] = useState<ColumnMap>(() => initialColumnMap(block, target, previous));
  const [name, setName] = useState(() => initialLayoutName(candidate));
  const [check, setCheck] = useState<SaveCheck | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const targetEl = useRef<HTMLSelectElement | null>(null);
  const columnEls = useRef(new Map<number, HTMLSelectElement>());

  const entries = useMemo(() => columnEntries(candidate.block, target, map, plant, canSeePrices), [candidate.block, target, map, plant, canSeePrices]);
  const status = mappingStatus(target, map);

  // A failed Save moves focus to the summary once it is on screen.
  useEffect(() => {
    if (check && !check.ok) summaryRef.current?.focus();
  }, [check]);

  const focusProblem = (focus: ProblemFocus) => {
    if (focus.kind === "name") nameRef.current?.focus();
    else if (focus.kind === "target") targetEl.current?.focus();
    else columnEls.current.get(focus.col)?.focus();
  };

  const changeTarget = (next: IngestTarget | null) => {
    setTarget(next);
    setMap(initialColumnMap(block, next, previous));
    setCheck(null);
  };
  const changeField = (col: number, field: string | null) => {
    if (target === null) return;
    setMap((m) => assignField(m, col, field, target, block));
  };
  const changeUnit = (col: number, unit: string | null) => setMap((m) => setColumnUnit(m, col, unit));
  const changeDate = (col: number, format: DateFormat) => setMap((m) => setColumnDateFormat(m, col, format));

  const submit = async () => {
    if (act.busy) return;
    const result = saveCheck({ target, name, map, block, previous });
    setCheck(result);
    if (!result.ok || !result.recipe) return;
    const ok = await act.saveShape(result.recipe, name.trim());
    if (ok) onSaved?.();
  };

  const problemOf = (kind: "name" | "target") => check?.problems.find((p) => p.focus.kind === kind);
  const targetProblem = problemOf("target");
  const nameProblem = problemOf("name");

  const registerColumn = (col: number) => (el: HTMLSelectElement | null) => {
    if (el) columnEls.current.set(col, el);
    else columnEls.current.delete(col);
  };

  const footer = (
    <>
      <ActionButton type="submit" busy={act.busy} working={act.pending === "shape"}>
        {t("ingest.shape.save")}
      </ActionButton>
      {onCancel ? (
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      ) : null}
    </>
  );

  return (
    <div id={id}>
      <EvidencePanel title={t("ingest.shape.title")}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t("ingest.shape.target")}
              required
              hint={chosen.suggestedByOrrn && target === chosen.value ? t("ingest.shape.suggested") : undefined}
              error={targetProblem ? words(targetProblem.words) : undefined}
            >
              <FieldSelect
                ref={(el) => {
                  targetEl.current = el;
                  if (typeof targetRef === "function") targetRef(el);
                  else if (targetRef) (targetRef as { current: HTMLSelectElement | null }).current = el;
                }}
                value={target ?? ""}
                onChange={(event) => changeTarget(event.currentTarget.value === "" ? null : (event.currentTarget.value as IngestTarget))}
              >
                {chosen.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>{words(choice.words)}</option>
                ))}
              </FieldSelect>
            </Field>
            <Field label={t("ingest.shape.saveAs")} required error={nameProblem ? words(nameProblem.words) : undefined}>
              <TextInput
                ref={nameRef}
                value={name}
                placeholder={t("ingest.shape.namePlaceholder")}
                maxLength={120}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </Field>
          </div>

          <p
            data-testid="mapping-status"
            data-state={status.state}
            className={cn(
              "m-0 text-[14px] leading-5 font-medium max-md:sticky max-md:top-[calc(3.5rem+env(safe-area-inset-top))] max-md:z-10 max-md:-mx-4 max-md:bg-card max-md:px-4 max-md:py-2",
              status.state === "done" ? "text-tone-green-ink" : status.state === "needed" ? "text-tone-amber-ink" : "text-muted-foreground",
            )}
          >
            {words(status.words)}
          </p>

          {check && !check.ok && check.summary ? (
            <div
              ref={summaryRef}
              role="alert"
              tabIndex={-1}
              className="flex flex-col gap-2 rounded-input border border-destructive/40 bg-tone-red-tint p-3 text-tone-red-ink outline-none"
            >
              <p className="m-0 text-[14px] font-semibold">{words(check.summary)}</p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
                {check.problems.map((problem) => (
                  <li key={problem.id}>
                    <a
                      href={`#${problem.id}`}
                      className="inline-flex min-h-6 pointer-coarse:min-h-11 items-center underline underline-offset-4"
                      onClick={(event) => {
                        event.preventDefault();
                        focusProblem(problem.focus);
                      }}
                    >
                      {words(problem.words)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {entries.length === 0 ? null : wide ? (
            <WideTable entries={entries} check={check} register={registerColumn} onField={changeField} onUnit={changeUnit} onDate={changeDate} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {entries.map((entry) => (
                <ColumnCard key={entry.col} entry={entry} check={check} register={registerColumn} onField={changeField} onUnit={changeUnit} onDate={changeDate} />
              ))}
            </ul>
          )}

          <ActionError error={act.failed("shape")} />
          <div className="hidden gap-3 lg:flex">{footer}</div>
          <IngestBar className="lg:hidden">{footer}</IngestBar>
        </form>
      </EvidencePanel>
    </div>
  );
}

type RowHandlers = {
  check: SaveCheck | null;
  register: (col: number) => (el: HTMLSelectElement | null) => void;
  onField: (col: number, field: string | null) => void;
  onUnit: (col: number, unit: string | null) => void;
  onDate: (col: number, format: DateFormat) => void;
};

function headerText(t: ReturnType<typeof useSay>["t"], entry: ColumnEntry): string {
  return entry.headerBlank ? t("ingest.rows.column", { n: entry.n }) : entry.header;
}

/**
 * The small label over a select in a column card (WCAG 3.3.2, 1.3.1). It says what the select is ("Goes into"), and a
 * visually hidden tail adds the file column it belongs to, so two cards never read alike. The table has column headers
 * instead, so there the select carries an `aria-label` and no visible label.
 */
function SelectLabel({ htmlFor, text, entry }: { htmlFor: string; text: string; entry: ColumnEntry }) {
  const { t } = useSay();
  return (
    <label htmlFor={htmlFor} className="text-[12px] leading-4 font-medium text-muted-foreground">
      {text}
      <span className="sr-only">: {headerText(t, entry)}</span>
    </label>
  );
}

/** "Goes into": the field select. In a card it has a visible label; in the table its name is the column title plus the file column. */
function IntoSelect({ entry, check, register, onField, labeled }: { entry: ColumnEntry; labeled?: boolean } & Pick<RowHandlers, "check" | "register" | "onField">) {
  const { t, words } = useSay();
  const id = useId();
  const message = check?.byColumn[entry.col];
  const errorId = `column-${entry.col}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {labeled ? <SelectLabel htmlFor={id} text={t("ingest.shape.field")} entry={entry} /> : null}
      <FieldSelect
        ref={register(entry.col)}
        id={labeled ? id : undefined}
        aria-label={labeled ? undefined : `${t("ingest.shape.field")}: ${headerText(t, entry)}`}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? errorId : undefined}
        value={entry.field ?? ""}
        onChange={(event) => onField(entry.col, event.currentTarget.value === "" ? null : event.currentTarget.value)}
      >
        {entry.options.map((option) => (
          <option key={option.value} value={option.value}>{words(option.words)}</option>
        ))}
      </FieldSelect>
      {message ? (
        <p id={errorId} className="m-0 text-[13px] font-medium text-destructive">{words(message)}</p>
      ) : null}
    </div>
  );
}

/** The unit of a number field, with labels ("kg per 12 ft"), or the date order of a date field. Nothing for the rest. */
function UnitSelect({ entry, onUnit, onDate, labeled }: { entry: ColumnEntry; labeled?: boolean } & Pick<RowHandlers, "onUnit" | "onDate">) {
  const { t } = useSay();
  const id = useId();
  const unit = entry.unit;
  if (!unit) return null;
  const text = unit.kind === "number" ? t("ingest.shape.unit") : t("ingest.shape.dateOrder");
  const name = labeled ? { id } : { "aria-label": `${text}: ${headerText(t, entry)}` };
  const select =
    unit.kind === "number" ? (
      <FieldSelect {...name} value={unit.value ?? ""} onChange={(event) => onUnit(entry.col, event.currentTarget.value === "" ? null : event.currentTarget.value)}>
        <option value="">{t(unit.askKey as never)}</option>
        {unit.choices.map((choice) => (
          <option key={choice.value} value={choice.value}>{t(choice.labelKey as never)}</option>
        ))}
      </FieldSelect>
    ) : (
      <FieldSelect {...name} value={unit.value} onChange={(event) => onDate(entry.col, event.currentTarget.value as DateFormat)}>
        {unit.choices.map((choice) => (
          <option key={choice.value} value={choice.value}>{choice.text}</option>
        ))}
      </FieldSelect>
    );
  if (!labeled) return select;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SelectLabel htmlFor={id} text={text} entry={entry} />
      {select}
    </div>
  );
}

function WideTable({ entries, ...handlers }: { entries: ColumnEntry[] } & RowHandlers) {
  const { t } = useSay();
  const columns: ResponsiveListColumn<ColumnEntry>[] = [
    {
      key: "column",
      header: t("ingest.shape.column"),
      cell: (e) => <ColumnHeaderCell header={e.header} headerBlank={e.headerBlank} n={e.n} kindKey={e.kind.key} muted={e.muted} />,
    },
    { key: "samples", header: t("ingest.shape.samples"), cell: (e) => <SampleCell samples={e.samples} /> },
    { key: "into", header: t("ingest.shape.field"), cell: (e) => <IntoSelect entry={e} {...handlers} /> },
    { key: "unit", header: t("ingest.shape.unit"), cell: (e) => <UnitSelect entry={e} onUnit={handlers.onUnit} onDate={handlers.onDate} /> },
    { key: "preview", header: t("ingest.shape.preview"), cell: (e) => <PreviewCell preview={e.preview} /> },
  ];
  return <ResponsiveList label={t("ingest.shape.title")} rows={entries} columns={columns} rowKey={(e) => String(e.col)} empty={null} />;
}

/** At phone width each file column is a card: header, samples, "Goes into" full width, the unit under it. */
function ColumnCard({ entry, ...handlers }: { entry: ColumnEntry } & RowHandlers) {
  const { t } = useSay();
  return (
    <li className={cn("flex flex-col gap-3 rounded-card border border-border p-3", entry.muted && "bg-surface-sunken/60")}>
      <ColumnHeaderCell header={entry.header} headerBlank={entry.headerBlank} n={entry.n} kindKey={entry.kind.key} muted={entry.muted} />
      <SampleCell samples={entry.samples} />
      <IntoSelect entry={entry} labeled {...handlers} />
      <UnitSelect entry={entry} labeled onUnit={handlers.onUnit} onDate={handlers.onDate} />
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13px] text-muted-foreground">
        <span>{t("ingest.shape.preview")}</span>
        <PreviewCell preview={entry.preview} />
      </p>
    </li>
  );
}
