import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { cn } from "@orrn/ui/lib/utils";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  answerFromValue,
  fieldLabelKey,
  questionList,
  questionText,
  targetFields,
  withYearQuestion,
  type CandidateDetail,
  type QuestionView,
} from "../lib";
import { ActionButton, EvidencePanel, FieldSelect, useSay } from "./review-bits";
import { usePlantUnits } from "../lib";
import { ActionError } from "./shared";
import { FOCUS, questionFocusKey, questionSentenceKey, type ReviewActions } from "./use-review-actions";

/** The control's value as the answer the server reads (the bare unit id, the bare field name, a format code). */
export function answerValue(question: QuestionView, value: string | boolean) {
  return answerFromValue(question.code, value);
}

type Act = Pick<ReviewActions, "answer" | "skipRows" | "busy" | "pending" | "failed">;

/**
 * Questions before approve (work order 3.3, S13). One row per question: its sentence, then the buttons that answer it,
 * all secondary (the decision bar holds the one loud button). An answered question shows its answer with a check and a
 * Change button. The year question is answered in the year line above, so its row only points there.
 */
export function QuestionsPanel({
  candidate,
  act,
  focusRef,
  onGoToRow,
  onGoToYear,
}: {
  candidate: Pick<CandidateDetail, "questions" | "target" | "periodConfirmed">;
  act: Act;
  /** `useFocusReturn().ref`: registers an element under a key so focus can come back to it. */
  focusRef: (key: string) => (el: HTMLElement | null) => void;
  onGoToRow?: (n: number) => void;
  onGoToYear?: () => void;
}) {
  const { t } = useSay();
  // An answered year question is the saved year line, which the bar already shows.
  const views = questionList(withYearQuestion(candidate), candidate.target).filter((q) => !(q.control.kind === "period" && q.answered));
  if (views.length === 0) return null;
  const open = views.filter((q) => !q.answered).length;
  const firstOpen = views.findIndex((q) => !q.answered);
  return (
    <EvidencePanel title={open > 0 ? t("ingest.questions.title", { count: open }) : t("ingest.questions.doneTitle", { count: views.length })}>
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {views.map((question, index) => (
          <QuestionRow
            key={`${question.code}:${question.subject}`}
            candidate={candidate}
            question={question}
            act={act}
            focusRef={focusRef}
            isFirstOpen={index === firstOpen}
            onGoToRow={onGoToRow}
            onGoToYear={onGoToYear}
          />
        ))}
      </ul>
      <ActionError error={act.failed("questions")} />
    </EvidencePanel>
  );
}

function QuestionRow({
  candidate,
  question,
  act,
  focusRef,
  isFirstOpen,
  onGoToRow,
  onGoToYear,
}: {
  candidate: Pick<CandidateDetail, "target">;
  question: QuestionView;
  act: Act;
  focusRef: (key: string) => (el: HTMLElement | null) => void;
  isFirstOpen: boolean;
  onGoToRow?: (n: number) => void;
  onGoToYear?: () => void;
}) {
  const { t, say, words } = useSay();
  const [editing, setEditing] = useState(false);
  const sentence = questionText(say, question);
  const key = questionFocusKey(question.code, question.subject);
  const showControls = !question.answered || editing;
  const controlsRef = useRef<HTMLDivElement>(null);
  const changeRef = useRef<HTMLButtonElement | null>(null);
  const was = useRef(false);

  // Change opens the controls and focus goes to the first one (WCAG 2.4.3). Leaving edit mode, by Cancel or by an answer,
  // puts focus back on Change, which stayed mounted (hidden) so there is a node to return to.
  useEffect(() => {
    if (editing) controlsRef.current?.querySelector<HTMLElement>("button, select, input")?.focus();
    else if (was.current) changeRef.current?.focus();
    was.current = editing;
  }, [editing]);

  const [confirmYes, setConfirmYes] = useState(false);
  const commit = async (value: string | boolean) => {
    const ok = await act.answer(question.subject, answerValue(question, value), key);
    if (ok) setEditing(false);
    return ok;
  };
  const send = async (value: string | boolean) => {
    if (act.busy) return;
    // No to Yes on the fill question brings back the lines "Skip these lines" skipped: say so before it happens.
    if (question.code === "order_fill_above" && question.answered && question.answer === false && value === true) {
      setConfirmYes(true);
      return;
    }
    await commit(value);
  };

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <p
          ref={(el) => {
            focusRef(questionSentenceKey(question.code, question.subject))(el);
            if (isFirstOpen) focusRef(FOCUS.firstQuestion)(el);
          }}
          tabIndex={-1}
          className="m-0 text-[15px] leading-6 font-semibold break-words outline-none"
        >
          {sentence}
        </p>
        {question.fillLines.length > 0 ? <FillLines lines={question.fillLines} /> : null}
        {question.aboutRow !== null && onGoToRow ? (
          <a
            href={`#row-${question.aboutRow}`}
            className="inline-flex min-h-6 items-center self-start text-[13px] text-muted-foreground underline underline-offset-4"
            onClick={(event) => {
              event.preventDefault();
              onGoToRow(question.aboutRow!);
            }}
          >
            {t("ingest.q.aboutRow", { n: question.aboutRow })}
          </a>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2 md:items-end">
        {question.answered ? (
          <div hidden={editing} className="flex flex-wrap items-center gap-2 md:justify-end">
            <Check aria-hidden="true" className="size-4 shrink-0 text-tone-green-ink" strokeWidth={2.5} />
            {question.answeredWords ? (
              <span className="text-[14px] break-words">{t("ingest.q.answered", { answer: words(question.answeredWords) })}</span>
            ) : null}
            <Button
              ref={(el) => {
                changeRef.current = el;
                focusRef(key)(el);
              }}
              variant="secondary"
              aria-disabled={act.busy || undefined}
              onClick={() => !act.busy && setEditing(true)}
            >
              {t("ingest.q.change")}
              <span className="sr-only">: {sentence}</span>
            </Button>
          </div>
        ) : null}
        {showControls ? (
          <div ref={controlsRef} className="flex min-w-0 flex-col gap-2 md:items-end">
            <QuestionControls
              candidate={candidate}
              question={question}
              sentence={sentence}
              act={act}
              send={send}
              focusKey={key}
              onGoToYear={onGoToYear}
            />
            {editing ? (
              <Button variant="ghost" className="self-start md:self-end" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <Dialog
        open={confirmYes}
        onOpenChange={setConfirmYes}
        title={t("ingest.fillChange.title")}
        description={t("ingest.fillChange.body")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmYes(false)}>
              {t("common.cancel")}
            </Button>
            <ActionButton
              variant="primary"
              busy={act.busy}
              working={act.pending === `answer:${question.subject}`}
              onClick={async () => {
                if (await commit(true)) setConfirmYes(false);
              }}
            >
              {t("common.yes")}
            </ActionButton>
          </>
        }
      />
    </li>
  );
}

function QuestionControls({
  candidate,
  question,
  sentence,
  act,
  send,
  focusKey,
  onGoToYear,
}: {
  candidate: Pick<CandidateDetail, "target">;
  question: QuestionView;
  sentence: string;
  act: Act;
  send: (value: string | boolean) => Promise<void>;
  focusKey: string;
  onGoToYear?: () => void;
}) {
  const { t, words } = useSay();
  const [value, setValue] = useState("");
  const { control } = question;
  const working = act.pending === `answer:${question.subject}`;
  const full = "w-full md:w-auto";

  if (control.kind === "period") {
    return (
      <Button variant="secondary" className={full} onClick={onGoToYear}>
        {t("ingest.q.goToYear")}
      </Button>
    );
  }

  const saveWith = (label: string, options: { value: string; label: string }[], placeholder: string, name = sentence) => (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <FieldSelect
        aria-label={name}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        className="md:w-60"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </FieldSelect>
      <ActionButton
        variant="secondary"
        className={full}
        busy={act.busy || value === ""}
        working={working}
        onClick={() => value !== "" && void send(value)}
      >
        {label}
      </ActionButton>
    </div>
  );

  if (control.kind === "unit") {
    return saveWith(t("ingest.q.save"), control.units.map((u) => ({ value: u.value, label: t(u.labelKey as never) })), t("ingest.shape.choose"));
  }
  if (control.kind === "column") {
    const fields = candidate.target ? targetFields(candidate.target) : [];
    if (fields.length === 0) {
      return (
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <Field label={sentence}>
            <TextInput value={value} onChange={(event) => setValue(event.currentTarget.value)} />
          </Field>
          <ActionButton variant="secondary" className={full} busy={act.busy || value.trim() === ""} working={working} onClick={() => value.trim() !== "" && void send(value.trim())}>
            {t("ingest.q.save")}
          </ActionButton>
        </div>
      );
    }
    return saveWith(t("ingest.q.save"), fields.map((f) => ({ value: f.name, label: t(fieldLabelKey(f.name) as never) })), t("ingest.shape.choose"));
  }

  const buttons = (
    <div role="group" aria-label={sentence} className="flex flex-col gap-2 md:flex-row md:flex-wrap md:justify-end">
      {question.answers.map((answer) => (
        <ActionButton
          key={String(answer.value)}
          variant="secondary"
          className={full}
          busy={act.busy}
          working={working}
          onClick={() => void send(answer.value)}
        >
          {words(answer.words)}
        </ActionButton>
      ))}
      {control.kind === "magnitude" && question.canSkipRows ? (
        <ActionButton
          variant="secondary"
          className={full}
          busy={act.busy}
          working={act.pending === `skip:${control.field}`}
          onClick={() => void act.skipRows(control.field, focusKey)}
        >
          {t("ingest.q.magnitudeSkip")}
        </ActionButton>
      ) : null}
    </div>
  );
  if (control.kind === "magnitude" && control.units.length > 0) {
    return (
      <div className={cn("flex flex-col gap-3 md:items-end")}>
        {buttons}
        {saveWith(
          t("ingest.q.save"),
          control.units.filter((u) => u.value !== control.likelyUnit).map((u) => ({ value: u.value, label: t(u.labelKey as never) })),
          t("ingest.q.magnitudeUnitPick"),
          `${sentence} ${t("ingest.q.magnitudeUnitPick")}`,
        )}
      </div>
    );
  }
  return buttons;
}

/** The lines that took a date from the dated line above them: row, order, the date taken, PO (at most five). */
function FillLines({ lines }: { lines: QuestionView["fillLines"] }) {
  const { t } = useSay();
  const plant = usePlantUnits();
  return (
    <table data-testid="fill-lines" className="mt-1 w-full max-w-[560px] border-collapse text-left text-[13px] leading-5">
      <caption className="sr-only">{t("ingest.q.fillCaption")}</caption>
      <thead>
        <tr className="text-muted-foreground">
          <th scope="col" className="py-1 pr-3 font-medium">{t("ingest.q.fillRow")}</th>
          <th scope="col" className="py-1 pr-3 font-medium">{t("ingest.q.fillOrder")}</th>
          <th scope="col" className="py-1 pr-3 font-medium">{t("ingest.q.fillDate")}</th>
          <th scope="col" className="py-1 font-medium">{t("ingest.q.fillPo")}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.n} className="border-t border-border align-top">
            <td className="py-1 pr-3 font-mono tabular-nums">{l.n}</td>
            <td className="py-1 pr-3 font-mono break-words">{l.order}</td>
            <td className="py-1 pr-3">{l.date ? plant.day(l.date) : <span className="text-muted-foreground">{t("ingest.q.fillNoDate")}</span>}</td>
            <td className="py-1 font-mono break-words">{l.po}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
