import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { X } from "lucide-react";
import { useId } from "react";

import { foundSummary, type HeaderReply, type KeptFile, type ReadNote, type StripEntry } from "../lib";
import { HeaderStep } from "./header-step";
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
  onHeader,
  headingId,
  storageNoticeShown,
}: {
  entries: StripEntry[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  /** The person's answer to "Which row has the column names?" for a file. */
  onHeader: (id: string, reply: HeaderReply) => void;
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
            {entry.notes && entry.notes.length > 0 ? <LeftOutNotes notes={entry.notes} /> : null}
            {entry.ask ? <HeaderStep key={entry.ask.position} view={entry.ask} fileName={entry.name} onReply={(reply) => onHeader(entry.id, reply)} /> : null}
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

/** Files a closed page left half way: one muted line each. Adding the same file again carries on from where it stopped. */
export function UnfinishedFiles({ files }: { files: readonly { id: string; name: string }[] }) {
  const { say } = useSay();
  if (files.length === 0) return null;
  // Over one file: a line, not a pile of amber lines; the names are under it (design check, minor 8).
  if (files.length > 1) {
    return (
      <div data-testid="unfinished-files" className="flex flex-col gap-1">
        <p className="m-0 text-[13px] leading-5 text-tone-amber-ink">{say("ingest.header.unfinishedMany", { count: files.length })}</p>
        <details>
          <summary className="min-h-6 cursor-pointer text-[13px] leading-5 text-muted-foreground pointer-coarse:min-h-11">{say("ingest.header.unfinishedNames")}</summary>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pt-1">
            {files.map((file) => (
              <li key={file.id} className="text-[13px] leading-5 break-words">
                <FileName name={file.name} />
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  }
  return (
    <ul data-testid="unfinished-files" className="m-0 flex list-none flex-col gap-1 p-0">
      {files.map((file) => (
        <li key={file.id} className="text-[13px] leading-5 break-words text-tone-amber-ink">
          {say("ingest.header.unfinished", { name: file.name })}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Kept, not read yet": the PDFs and photos orrn stored and does not read in this release. Each shows its name, size and
 * date. One line says when reading them comes.
 */
export function KeptFiles({ files, storageOff = false }: { files: readonly KeptFile[]; storageOff?: boolean }) {
  const { t } = useT();
  const { say } = useSay();
  const headingId = useId();
  if (files.length === 0) return null;
  return (
    <section aria-labelledby={headingId} data-testid="kept-files" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="m-0 text-[14px] font-semibold">
          {t("ingest.kept.title")}
        </h2>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("ingest.kept.note")}</p>
        {/* Storage can be turned off after files were kept: say so, or this card contradicts the "not kept" line at the top. */}
        {storageOff ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("ingest.kept.beforeOff")}</p> : null}
      </div>
      <ul className="m-0 list-none divide-y divide-border p-0">
        {files.map((file) => (
          <li key={file.id} className="flex min-w-0 flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <FileName name={file.name} className="font-semibold" />
            <p className="m-0 shrink-0 text-[13px] leading-5 text-muted-foreground">
              <span className="font-mono tabular-nums">{file.size}</span>
              {", "}
              {say("ingest.kept.addedOn", { date: file.date })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Up to this many sections are listed open; more are summarised and open on request. */
const SECTIONS_OPEN = 12;

/**
 * What the reader left out of a table (rule 8.1): the blank rows it crossed, a repeated header, a title line, a note under
 * the table. Nothing skipped is hidden: each row is listed with its number and its text, folded when there are many.
 */
export function LeftOutNotes({ notes }: { notes: readonly ReadNote[] }) {
  const { say } = useSay();
  const gaps = notes.reduce((n, note) => n + note.gaps, 0);
  const rows = notes.flatMap((note) => note.rows);
  const sections = notes.flatMap((note) => note.sections);
  return (
    <div data-testid="left-out" className="flex min-w-0 flex-col gap-1 text-[13px] leading-5 text-muted-foreground">
      {gaps > 0 ? <p className="m-0">{say("ingest.read.gaps", { count: gaps })}</p> : null}
      {sections.length > 0 ? (
        <details open={sections.length <= SECTIONS_OPEN}>
          <summary className="min-h-6 cursor-pointer pointer-coarse:min-h-11">{say("ingest.read.sections", { count: sections.length })}</summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            {sections.map((section) => (
              <li key={`${section.n}:${section.text}`} className="break-words">
                {say("ingest.read.section", { text: section.text, n: section.n })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {rows.length > 0 ? (
        <details open={rows.length <= 3}>
          <summary className="min-h-6 cursor-pointer pointer-coarse:min-h-11">{say("ingest.read.leftOut", { count: rows.length })}</summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            {rows.map((row) => (
              <li key={`${row.n}:${row.code}`} className="break-words">
                {say(`ingest.read.${row.code}`, { n: row.n, text: row.text })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
