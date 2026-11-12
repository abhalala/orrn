import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";

import { can, useMe } from "@/shared/lib/me";

import { useAnnouncer, useArtifact } from "../lib";
import { fileRows, fileSubtitle, fileYear, fillAnswerWords, vaultWords } from "../lib/file-model";
import { FileYearLine } from "./file-year-line";
import { ImportRows, StatusRegion, useDocTitle, useListActions, useSay } from "./list-kit";
import { ActionError, ProgressBar, QueryPanel } from "./shared";

/**
 * `/ingest/files/:id` (work order 3.5): the file's name as the title, rows, tables and the day under it, one muted
 * line for whether the original is kept, the year line once for a file of orders or bundles, and each table as one
 * row of the same list the candidates page uses, with its columns on a second line.
 */
export function IngestFileScreen({ artifactId }: { artifactId: string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const { say, words, plant } = useSay();
  const artifact = useArtifact(artifactId);
  const announcer = useAnnouncer();
  const data = artifact.data;
  useDocTitle(data ? say("ingest.docTitle.page", { name: data.fileName }) : null);

  const rows = data ? fileRows(data.blocks, { merge: can(me, "ingest.merge"), upload: can(me, "ingest.upload") }) : [];
  const columnsOf = new Map(rows.map((r) => [r.row.id, r.columns]));
  const approvedCount = rows.filter((r) => r.row.candidate.state === "approved").length;
  const { controls, error } = useListActions({
    visibleIds: rows.map((r) => r.row.id),
    approvedCount,
    announce: announcer.announce,
  });
  const year = data ? fileYear(data, plant.day) : null;

  return (
    <>
      <PageHeader
        back={{ to: "/ingest", label: t("ingest.title") }}
        title={data?.fileName ?? t("common.loading")}
        subtitle={data ? words(fileSubtitle(data, (ms) => plant.fmt.date(ms))) : undefined}
      />
      <StatusRegion message={announcer.message} />
      <QueryPanel query={artifact}>
        {data ? (
          <>
            <div className="flex flex-col gap-1">
              <p className="m-0 text-[13px] leading-5 text-muted-foreground">{words(vaultWords(data.vaultState))}</p>
              {fillAnswerWords(data) ? <p data-testid="file-fill-answer" className="m-0 text-[13px] leading-5 text-muted-foreground">{words(fillAnswerWords(data)!)}</p> : null}
              {data.note ? (
                <p className="m-0 text-[13px] leading-5 break-words text-muted-foreground">
                  {t("common.note")}: {data.note}
                </p>
              ) : null}
            </div>
            {data.readState === "reading" ? <ProgressBar value={null} label={t("ingest.read.working")} /> : null}
            {data.readState === "failed" ? <p className="m-0 text-[14px] leading-6 text-tone-red-ink">{t("ingest.read.failed")}</p> : null}
            {year && year.show ? <FileYearLine artifactId={data.id} line={year} confirmed={data.periodConfirmed} announce={announcer.announce} /> : null}
            <ActionError error={error} />
            {rows.length === 0 && data.readState !== "reading" ? (
              <div className="rounded-card border border-border bg-card">
                <EmptyState title={t("ingest.empty.title")} body={t("ingest.empty.body")} />
              </div>
            ) : rows.length > 0 ? (
              <ImportRows
                rows={rows.map((r) => r.row)}
                label={data.fileName}
                controls={controls}
                extra={(row) => {
                  const columns = columnsOf.get(row.id) ?? [];
                  return columns.length > 0 ? (
                    <span className="text-[13px] leading-5 font-normal break-words text-muted-foreground">
                      {say("ingest.file.columnsIn", { names: columns.join(", ") })}
                    </span>
                  ) : null;
                }}
              />
            ) : null}
          </>
        ) : null}
      </QueryPanel>
    </>
  );
}
