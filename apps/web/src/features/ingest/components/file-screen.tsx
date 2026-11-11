import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";

import { useArtifact } from "../lib";
import { CandidateCard } from "./candidate-card";
import { PeriodPanel } from "./period-panel";
import { InlineNotice, Panel, ProgressBar, QueryPanel } from "./shared";

export function IngestFileScreen({ artifactId }: { artifactId: string }) {
  const { t } = useT();
  const artifact = useArtifact(artifactId);
  const data = artifact.data;
  return (
    <>
      <PageHeader back={{ to: "/ingest", label: t("ingest.title") }} title={data?.fileName ?? t("ingest.title")} subtitle={t("ingest.lead")} />
      <QueryPanel query={artifact}>
        {data ? (
          <>
            <Panel title={data.fileName}>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={data.vaultState === "stored" ? "green" : data.vaultState === "not_stored" ? "amber" : "blue"}>
                  {data.vaultState === "stored" ? t("common.saved") : data.vaultState === "not_stored" ? t("ingest.vault.off") : t("common.loading")}
                </Chip>
                <span className="text-[14px] text-muted-foreground">{t("common.total")} {data.rowCount}</span>
              </div>
              {data.vaultState === "not_stored" ? <InlineNotice>{t("ingest.vault.off")}</InlineNotice> : null}
              {data.note ? <p className="m-0 text-[14px] leading-6 break-words"><span className="font-semibold">{t("common.note")}</span> {data.note}</p> : null}
              {data.readState === "reading" ? <ProgressBar value={null} label={t("ingest.state.processing")} /> : null}
              {data.readState === "failed" ? <InlineNotice tone="danger">{t("ingest.read.failed")}</InlineNotice> : null}
            </Panel>
            <PeriodPanel key={data.id} artifactId={data.id} period={data.period} confirmed={data.periodConfirmed} />
            {data.blocks.length === 0 && data.readState !== "reading" ? (
              <div className="rounded-card border border-border bg-card"><EmptyState title={t("ingest.empty.title")} body={t("ingest.empty.body")} /></div>
            ) : null}
            {data.blocks.map((block) => (
              <Panel key={block.id} title={block.sheetName ?? block.title ?? `${t("ingest.title")} ${block.ordinal + 1}`}>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                  <span>{t("common.total")} {block.rowCount}</span>
                  <span>{t("ingest.shape.column")} {block.columnCount}</span>
                </div>
                {block.headers.length > 0 ? <p className="m-0 text-[13px] leading-6 break-words text-muted-foreground">{block.headers.join(" · ")}</p> : null}
                {block.candidates.length > 0 ? (
                  <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 xl:grid-cols-2">
                    {block.candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} onDone={() => void artifact.refetch()} />)}
                  </ul>
                ) : null}
              </Panel>
            ))}
          </>
        ) : null}
      </QueryPanel>
    </>
  );
}
