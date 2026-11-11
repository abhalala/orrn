import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput, useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect, type NativeSelectProps } from "@orrn/ui/components/native-select";
import { forwardRef, useRef, useState } from "react";

import { financialYears, useFocusReturn, useIngestActions, useRunAction, yearProblems, type YearLine } from "../lib";
import { useSay } from "./list-kit";
import { ActionError } from "./shared";

/** A select that takes its label, hint and error from the `Field` around it (a bare `NativeSelect` has no name). */
const FieldSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(function FieldSelect(
  { id, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest },
  ref,
) {
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid });
  return <NativeSelect ref={ref} {...a11y} {...rest} />;
});

/**
 * The year line of a file (work order 3.5): which financial year it is from, asked once for the whole file. It says
 * what orrn guessed and from what, offers the last five years with the guess preselected, and after Save says the
 * saved year with "Change". The form takes focus only when the person opened it.
 */
export function FileYearLine({
  artifactId,
  line,
  confirmed,
  announce,
}: {
  artifactId: string;
  line: YearLine;
  confirmed: { fy: string | null; asOf: string | null } | null;
  announce: (text: string) => void;
}) {
  const { t } = useT();
  const { say, words, plant } = useSay();
  const focus = useFocusReturn();
  const actions = useIngestActions();
  const runner = useRunAction();
  const today = new Date().toISOString().slice(0, 10);
  const [editing, setEditing] = useState(false);
  const [fy, setFy] = useState(line.show && line.mode === "ask" ? line.fy : "");
  const [asOf, setAsOf] = useState(line.show && line.mode === "ask" ? line.asOf : "");
  const [problems, setProblems] = useState<ReturnType<typeof yearProblems>>({});
  const fyRef = useRef<HTMLSelectElement>(null);
  const asOfRef = useRef<HTMLInputElement>(null);

  if (!line.show) return null;
  const asking = line.mode === "ask" || editing;
  const options = line.mode === "ask" ? line.options : financialYears(today, confirmed?.fy ?? null);

  const open = () => {
    setFy(confirmed?.fy ?? "");
    setAsOf(confirmed?.asOf ?? "");
    setProblems({});
    setEditing(true);
    // Only a form the person opened takes focus.
    requestAnimationFrame(() => fyRef.current?.focus());
  };
  const save = async () => {
    const found = yearProblems({ fy, asOf });
    setProblems(found);
    if (found.fy) return void fyRef.current?.focus();
    if (found.asOf) return void asOfRef.current?.focus();
    const ok = await runner.run("period", () => actions.confirmPeriod(artifactId, fy, asOf));
    if (!ok) return;
    setEditing(false);
    announce(say("ingest.period.done", { fy, date: plant.day(asOf) }));
    focus.request(["change-year"]);
  };

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      {asking ? (
        <>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="m-0 text-[15px] font-semibold">{words(line.mode === "ask" ? line.ask : { key: "ingest.period.ask" })}</h2>
            <p className="m-0 text-[14px] leading-6 text-muted-foreground">{words(line.mode === "ask" ? line.guess : { key: "ingest.period.noGuess" })}</p>
            {line.mode === "ask" && line.why ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{words(line.why)}</p> : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field label={t("ingest.period.fy")} error={problems.fy ? words(problems.fy) : undefined} className="sm:w-48">
              <FieldSelect ref={fyRef} value={fy} onChange={(event) => setFy(event.currentTarget.value)}>
                {fy === "" ? <option value="">{t("ingest.shape.choose")}</option> : null}
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FieldSelect>
            </Field>
            <Field label={t("ingest.period.asOf")} error={problems.asOf ? words(problems.asOf) : undefined} className="sm:w-48">
              <TextInput ref={asOfRef} type="date" value={asOf} onChange={(event) => setAsOf(event.currentTarget.value)} />
            </Field>
            <div className="sm:self-end">
              <Button
                variant="secondary"
                className="max-sm:w-full"
                aria-disabled={runner.busy || undefined}
                aria-busy={runner.busy || undefined}
                onClick={() => void save()}
              >
                {t("ingest.period.save")}
              </Button>
            </div>
          </div>
          <ActionError error={runner.error} />
        </>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="m-0 text-[15px] font-medium">{words(line.mode === "saved" ? line.saved : { key: "ingest.period.ask" })}</p>
          <Button ref={focus.ref("change-year")} variant="ghost" onClick={open}>
            {t("ingest.period.change")}
          </Button>
        </div>
      )}
    </section>
  );
}
