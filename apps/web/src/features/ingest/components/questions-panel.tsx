import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { cn } from "@orrn/ui/lib/utils";
import { Check } from "lucide-react";
import { useState } from "react";

import {
  answerFromValue,
  fieldLabelKey,
  questionList,
  questionText,
  targetFields,
  type CandidateDetail,
  type QuestionView,
} from "../lib";
import { ActionButton, EvidencePanel, FieldSelect, useSay } from "./review-bits";
import { ActionError } from "./shared";
import { FOCUS, questionFocusKey, type ReviewActions } from "./use-review-actions";

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
  candidate: Pick<CandidateDetail, "questions" | "target">;
  act: Act;
  /** `useFocusReturn().ref`: registers an element under a key so focus can come back to it. */
  focusRef: (key: string) => (el: HTMLElement | null) => void;
  onGoToRow?: (n: number) => void;
  onGoToYear?: () => void;
}) {
  const { t } = useSay();
  // An answered year question is the saved year line, which the bar already shows.
  const views = questionList(candidate.questions, candidate.target).filter((q) => !(q.control.kind === "period" && q.answered));
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

  const send = async (value: string | boolean) => {
    if (act.busy) return;
    const ok = await act.answer(question.subject, answerValue(question, value), key);
    if (ok) setEditing(false);
  };

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <p
          ref={isFirstOpen ? focusRef(FOCUS.firstQuestion) : undefined}
          tabIndex={-1}
          className="m-0 text-[15px] leading-6 font-semibold break-words outline-none"
        >
          {sentence}
        </p>
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
        {question.answered && !editing ? (
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <Check aria-hidden="true" className="size-4 shrink-0 text-tone-green-ink" strokeWidth={2.5} />
            {question.answeredWords ? (
              <span className="text-[14px] break-words">{t("ingest.q.answered", { answer: words(question.answeredWords) })}</span>
            ) : null}
            <Button ref={focusRef(key)} variant="secondary" aria-disabled={act.busy || undefined} onClick={() => !act.busy && setEditing(true)}>
              {t("ingest.q.change")}
              <span className="sr-only">: {sentence}</span>
            </Button>
          </div>
        ) : null}
        {showControls ? (
          <QuestionControls
            candidate={candidate}
            question={question}
            sentence={sentence}
            act={act}
            send={send}
            focusKey={key}
            onGoToYear={onGoToYear}
          />
        ) : null}
      </div>
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
