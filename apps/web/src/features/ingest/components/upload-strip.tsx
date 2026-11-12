import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { X } from "lucide-react";

import { foundSummary, type StripEntry } from "../lib";
import { FileName, ForeignText, useSay } from "./list-kit";
import { ProgressBar } from "./shared";

/**
 * "Files being added" (work order 3.1): one row for each file being read and each import being checked, in one
 * card right under the header. A file shows its name, what it is doing and a bar; once read it says what was found
 * and offers Review. A file seen before says when, with "Open it". The model (`uploadStrip`) decides all of it.
 */
export function UploadStrip({
  entries,
  onRetry,
  onRemove,
  headingId,
  storageNoticeShown,
}: {
  entries: StripEntry[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  /** The heading is shared with the staged files, so the screen draws it. */
  headingId: string;
  /** The page already says the original file is not kept: a file does not say it again. */
  storageNoticeShown?: boolean;
}) {
  const { t } = useT();
  const { say, words } = useSay();
  if (entries.length === 0) return null;
  return (
    <ul aria-labelledby={headingId} className="m-0 list-none divide-y divide-border p-0">
      {entries.map((entry) => {
        if (entry.kind === "checking") {
          const title = entry.title.kind === "sheet" ? entry.title.name : say(entry.title.key);
          return (
            <li key={entry.id} data-step="checking" className="flex min-w-0 flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-semibold break-words">{entry.title.kind === "sheet" ? <ForeignText>{title}</ForeignText> : title}</span>
                  <FileName name={entry.fileName} className="text-muted-foreground" />
                </div>
                <Chip tone="blue" truncate={false}>
                  {words(entry.chip)}
                </Chip>
              </div>
              <ProgressBar value={entry.progress} label={t("ingest.read.working")} />
            </li>
          );
        }
        const reading = entry.progress !== undefined;
        const line = entry.words ? words(entry.words) : null;
        const problem = entry.step === "refused" || entry.step === "failed";
        return (
          <li key={entry.id} data-step={entry.step} className="flex min-w-0 flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <FileName name={entry.name} className="font-semibold" />
                {reading ? (
                  <ProgressBar value={entry.progress ?? null} label={line ?? t("ingest.read.working")} />
                ) : entry.found ? (
                  <p className="m-0 text-[14px] leading-6 break-words">
                    {entry.found.count > 0 ? foundSummary(say, entry.found) : t("ingest.drop.noTables")}
                  </p>
                ) : line ? (
                  <p className={problem ? "m-0 text-[14px] leading-6 break-words text-tone-amber-ink" : "m-0 text-[14px] leading-6 break-words text-muted-foreground"}>{line}</p>
                ) : null}
                {entry.notStored && !storageNoticeShown ? <p className="m-0 text-[13px] text-muted-foreground">{t("ingest.vault.notStored")}</p> : null}
                {entry.canonicalMissing ? <p className="m-0 text-[13px] text-muted-foreground">{t("ingest.read.canonicalMissing")}</p> : null}
              </div>
              <IconButton label={`${t("common.remove")}: ${entry.name}`} icon={<X aria-hidden="true" />} onClick={() => onRemove(entry.id)} />
            </div>
            {entry.actions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {entry.actions.includes("review") && entry.found?.firstCandidateId ? (
                  <Button asChild variant="secondary" className="max-sm:w-full">
                    <UiLink to={`/ingest/review/${entry.found.firstCandidateId}`} aria-label={`${t("ingest.action.review")}: ${entry.name}`}>
                      {t("ingest.action.review")}
                    </UiLink>
                  </Button>
                ) : null}
                {entry.actions.includes("open") && entry.artifactId ? (
                  <Button asChild variant="secondary" className="max-sm:w-full">
                    <UiLink to={`/ingest/files/${entry.artifactId}`} aria-label={`${t("ingest.drop.openIt")}: ${entry.name}`}>
                      {t("ingest.drop.openIt")}
                    </UiLink>
                  </Button>
                ) : null}
                {entry.actions.includes("retry") ? (
                  <Button variant="secondary" className="max-sm:w-full" aria-label={`${t("common.retry")}: ${entry.name}`} onClick={() => onRetry(entry.id)}>
                    {t("common.retry")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Files the person chose and has not started yet: the note field above, one row each with a remove button, then
 * "Add N files" and Cancel. The note is sent when a file starts, so it is typed here, before. It shows only now.
 */
export function StagedFiles({
  files,
  note,
  onNote,
  onRemove,
  onStart,
  onCancel,
}: {
  files: readonly { name: string }[];
  note: string;
  onNote: (value: string) => void;
  onRemove: (index: number) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const { say } = useSay();
  return (
    <div data-testid="staged-files" className="flex flex-col gap-3">
      <Field label={t("ingest.drop.note")} className="max-w-[560px]">
        <TextInput value={note} maxLength={500} onChange={(event) => onNote(event.currentTarget.value)} />
      </Field>
      <ul className="m-0 list-none divide-y divide-border p-0">
        {files.map((file, index) => (
          <li key={`${file.name}:${index}`} className="flex min-w-0 items-center justify-between gap-3 py-1 first:pt-0 last:pb-0">
            <FileName name={file.name} className="font-semibold" />
            <IconButton label={`${t("common.remove")}: ${file.name}`} icon={<X aria-hidden="true" />} onClick={() => onRemove(index)} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="max-sm:w-full" onClick={onStart}>
          {say("ingest.imports.startFiles", { count: files.length })}
        </Button>
        <Button variant="ghost" className="max-sm:w-full" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
