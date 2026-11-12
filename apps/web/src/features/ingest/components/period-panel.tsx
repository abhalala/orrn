import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { useEffect, useRef, useState, type Ref } from "react";

import {
  financialYears,
  useIngestActions,
  usePlantUnits,
  yearLine,
  yearProblems,
  type PeriodGuess,
  type YearLine as YearLineModel,
} from "../lib";
import { ActionButton, DayInput, FieldSelect, Muted, useSay } from "./review-bits";
import { ActionError } from "./shared";
import type { ReviewActions } from "./use-review-actions";

/**
 * The year line (work order 3.3, M8): one line inside the decision bar, only for orders and bundles or an open
 * `period_needed` question. It says which year orrn guessed and from what, offers five financial years, and saves for the
 * whole file, so it is asked once. Once saved it is one line with a Change button.
 *
 * Focus (S12): the year field takes focus only when the person pressed Change. A form that is simply there (the year is
 * still needed) never steals it. The Change button stays mounted while the form is open, hidden, so the place it returns
 * to is never an unmounted node.
 */
export function YearLine({
  line,
  act,
  announce,
  selectRef,
  changeRef,
  saved: current,
}: {
  line: YearLineModel;
  /** The year the file already has, so Change starts from it and offers the five years around it. */
  saved?: { fy: string | null; asOf: string | null } | null;
  act: Pick<ReviewActions, "saveYear" | "busy" | "pending" | "failed">;
  announce: (text: string) => void;
  selectRef?: Ref<HTMLSelectElement>;
  changeRef?: Ref<HTMLButtonElement>;
}) {
  const { t, words, say } = useSay();
  const plant = usePlantUnits();
  const [editing, setEditing] = useState(false);
  const [fy, setFy] = useState(line.show && line.mode === "ask" ? line.fy : "");
  const [asOf, setAsOf] = useState(line.show && line.mode === "ask" ? line.asOf : "");
  const [problems, setProblems] = useState<ReturnType<typeof yearProblems>>({});
  const localSelect = useRef<HTMLSelectElement | null>(null);
  const localDate = useRef<HTMLInputElement | null>(null);
  const opened = useRef(false);
  const localChange = useRef<HTMLButtonElement | null>(null);
  const wasEditing = useRef(false);

  // Press Change: the form opens and takes focus. A form that was already open does not. Leaving the form (Cancel or Save)
  // puts focus back on Change, which stayed mounted, hidden, so there is a node to return to (WCAG 2.4.3).
  useEffect(() => {
    if (editing && opened.current) localSelect.current?.focus();
    else if (!editing && wasEditing.current) localChange.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  if (!line.show) return null;

  const saved = line.mode === "saved" ? line : null;
  const ask = line.mode === "ask" ? line : null;
  // The form shows when the year is still needed, or after Change. After Change it starts from the saved values.
  const formOpen = ask !== null || editing;
  const options = ask?.options ?? financialYears(new Date().toISOString().slice(0, 10), current?.fy ?? null);

  const save = async () => {
    if (act.busy) return;
    const found = yearProblems({ fy, asOf });
    setProblems(found);
    if (found.fy) {
      localSelect.current?.focus();
      return;
    }
    if (found.asOf) {
      localDate.current?.focus();
      return;
    }
    const ok = await act.saveYear(fy, asOf);
    if (ok) {
      setEditing(false);
      opened.current = false;
      announce(t("ingest.period.done", { fy, date: plant.day(asOf) }));
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="year-line">
      {saved ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="m-0 text-[15px] leading-6 break-words">{words(saved.saved)}</p>
          <Button
            ref={(el) => {
              localChange.current = el;
              if (typeof changeRef === "function") changeRef(el);
              else if (changeRef) (changeRef as { current: HTMLButtonElement | null }).current = el;
            }}
            variant="ghost"
            size="sm"
            hidden={editing}
            aria-expanded={editing}
            onClick={() => {
              opened.current = true;
              setFy(current?.fy ?? "");
              setAsOf(current?.asOf ?? "");
              setProblems({});
              setEditing(true);
            }}
          >
            {words(saved.change)}
          </Button>
        </div>
      ) : null}
      {formOpen ? (
        <form
          role="group"
          aria-labelledby="year-line-ask"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1">
            <p id="year-line-ask" className="m-0 text-[15px] leading-6 font-semibold">
              {t("ingest.period.ask")}
            </p>
            {ask ? <Muted>{words(ask.guess)}</Muted> : null}
            {ask?.why ? <Muted>{words(ask.why)}</Muted> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,13rem)_auto] sm:items-start">
            <Field label={t("ingest.period.fy")} required error={problems.fy ? words(problems.fy) : undefined}>
              <FieldSelect
                ref={(el) => {
                  localSelect.current = el;
                  if (typeof selectRef === "function") selectRef(el);
                  else if (selectRef) (selectRef as { current: HTMLSelectElement | null }).current = el;
                }}
                value={fy}
                onChange={(event) => setFy(event.currentTarget.value)}
              >
                <option value="">{t("ingest.shape.choose")}</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </FieldSelect>
            </Field>
            <Field label={t("ingest.period.asOf")} required hint={/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? plant.day(asOf) : undefined} error={problems.asOf ? words(problems.asOf) : undefined}>
              <DayInput ref={localDate} value={asOf} onChange={setAsOf} />
            </Field>
            <div className="flex flex-wrap gap-2 sm:pt-[26px]">
              <ActionButton type="submit" variant="secondary" busy={act.busy} working={act.pending === "year"}>
                {say("ingest.period.save")}
              </ActionButton>
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    opened.current = false;
                  }}
                >
                  {t("common.cancel")}
                </Button>
              ) : null}
            </div>
          </div>
          <ActionError error={act.failed("year")} />
        </form>
      ) : null}
    </div>
  );
}

/**
 * The year of a whole file for the file screen, kept so that screen compiles until it is rebuilt on `YearLine`. It builds
 * the same view model from the file's period and saves with the same call. New code uses `YearLine` directly.
 */
export function PeriodPanel({
  artifactId,
  period,
  confirmed,
}: {
  artifactId: string;
  period: PeriodGuess | null;
  confirmed: { fy: string | null; asOf: string | null } | null;
}) {
  const plant = usePlantUnits();
  const actions = useIngestActions();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const line = yearLine({ target: "orders", questions: [], period, periodConfirmed: confirmed }, plant.day);
  const act = {
    busy: pending,
    pending: pending ? "year" : null,
    failed: () => failure,
    saveYear: async (fy: string | null, asOf: string | null) => {
      setPending(true);
      setFailure(null);
      try {
        await actions.confirmPeriod(artifactId, fy, asOf);
        return true;
      } catch (error) {
        setFailure(error);
        return false;
      } finally {
        setPending(false);
      }
    },
  };
  return (
    <div className="rounded-card border border-border bg-card p-4 sm:p-5">
      <YearLine line={line} act={act} announce={() => undefined} saved={confirmed} />
    </div>
  );
}
