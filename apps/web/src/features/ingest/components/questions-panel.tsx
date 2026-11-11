import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useState } from "react";
import { TARGETS, UNIT_KINDS, unitsFor, type UnitKind } from "@orrn/ingest";

import {
  answerFromValue,
  questionList,
  useIngestActions,
  type CandidateDetail,
  type QuestionView,
} from "../lib";
import { ActionError, Panel, translateKey } from "./shared";
import { PeriodConfirm } from "./period-panel";

export function QuestionsPanel({ candidate, onSaved }: { candidate: CandidateDetail; onSaved?: () => void }) {
  const { t } = useT();
  const questions = questionList(candidate.questions);
  if (questions.length === 0) return null;
  return (
    <Panel title={t("ingest.group.needsYou")}>
      <div className="flex flex-col gap-4">
        {questions.map((question) => (
          <QuestionCard key={`${question.code}:${question.subject}`} candidate={candidate} question={question} onSaved={onSaved} />
        ))}
      </div>
    </Panel>
  );
}

/** The control's value as the answer the server reads (the bare unit id, the bare field name, a format code). */
export function answerValue(question: QuestionView, value: string | boolean) {
  return answerFromValue(question.code, value);
}

function QuestionCard({ candidate, question, onSaved }: { candidate: CandidateDetail; question: QuestionView; onSaved?: () => void }) {
  const { t } = useT();
  const actions = useIngestActions();
  const initial = typeof question.answer === "string"
    ? question.answer
    : question.answer && typeof question.answer === "object"
      ? String(Object.values(question.answer)[0] ?? "")
      : "";
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const fields = candidate.target ? TARGETS[candidate.target].fields : [];
  const unitKind = question.control.kind === "unit" && UNIT_KINDS.includes(question.control.unitKind as UnitKind)
    ? question.control.unitKind as UnitKind
    : null;
  const units = unitKind
    ? unitsFor(unitKind)
    : [...new Set(UNIT_KINDS.flatMap((kind) => unitsFor(kind)))];

  const save = async (answer: ReturnType<typeof answerValue>) => {
    setPending(true);
    setFailed(null);
    try {
      await actions.answer(candidate.id, question.subject, answer, candidate.serverSeq);
      onSaved?.();
    } catch (error) {
      setFailed(error);
    } finally {
      setPending(false);
    }
  };

  if (question.control.kind === "period") {
    return (
      <section aria-label={translateKey(t, question.key, question.vars)} className="flex flex-col gap-3 border-b border-border pb-4 last:border-0 last:pb-0">
        <h3 className="m-0 text-[15px] font-semibold leading-6">{translateKey(t, question.key, question.vars)}</h3>
        {question.answered ? null : (
          <PeriodConfirm
            artifactId={candidate.artifactId}
            initialFy={candidate.period?.fy ?? ""}
            initialAsOf={candidate.period?.asOf ?? ""}
            onClose={onSaved}
          />
        )}
      </section>
    );
  }

  const label = translateKey(t, question.key, question.vars);
  return (
    <section aria-label={label} className="flex flex-col gap-3 border-b border-border pb-4 last:border-0 last:pb-0">
      <h3 className="m-0 text-[15px] font-semibold leading-6 break-words">{label}</h3>
      {question.control.kind === "choice" ? (
        <div className="flex flex-wrap gap-2">
          {question.control.options.map((option, index) => (
            <Button
              key={option.value}
              size="sm"
              variant={index === 0 ? "primary" : "secondary"}
              disabled={question.answered || pending}
              onClick={() => void save(answerValue(question, option.value))}
            >
              {option.labelKey ? translateKey(t, option.labelKey) : option.label}
            </Button>
          ))}
        </div>
      ) : question.control.kind === "yesNo" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={question.answered || pending} onClick={() => void save(answerValue(question, true))}>{t("common.yes")}</Button>
          <Button size="sm" variant="secondary" disabled={question.answered || pending} onClick={() => void save(answerValue(question, false))}>{t("common.no")}</Button>
        </div>
      ) : (
        <Field label={label}>
          {question.control.kind === "column" && fields.length === 0 ? (
            <TextInput value={value} disabled={question.answered} onChange={(event) => setValue(event.currentTarget.value)} />
          ) : (
            <NativeSelect value={value} disabled={question.answered} onChange={(event) => setValue(event.currentTarget.value)} aria-label={label}>
              <option value="">{t("ingest.shape.notUsed")}</option>
              {question.control.kind === "unit" ? units.map((unit) => <option key={unit} value={unit}>{unit}</option>) : null}
              {question.control.kind === "column" ? fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>) : null}
            </NativeSelect>
          )}
        </Field>
      )}
      {question.control.kind !== "yesNo" && question.control.kind !== "choice" && !question.answered ? (
        <div>
          <Button
            size="sm"
            loading={pending}
            disabled={!value}
            onClick={() => void save(answerValue(question, value))}
          >
            {t("common.save")}
          </Button>
        </div>
      ) : null}
      <ActionError error={failed} />
    </section>
  );
}
