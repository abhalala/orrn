import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useEffect, useId, type ReactNode } from "react";

import { blockVisionOf, reviewDocTitle, reviewHeader, useCandidate, usePlantUnits, useVisionWaiting, type CandidateDetail, type VisionWaitingItem } from "../lib";
import { Muted, useSay } from "./review-bits";
import { QueryPanel } from "./shared";
import { VisionCheckPanel } from "./vision-check-panel";

/**
 * Item 16 (owner decision "Price-viewers tick, admin approves"): the import screens of a person who holds `ingest.check`
 * only (office, manager, accountant). The Imports page is the list of tables waiting for a check; a review is the page
 * check of one model-read table, read only, with its tick. No upload, answers, mapping, Approve or discard here.
 */

/** "Tables waiting for a check": read only, one link per table to its review. */
export function VisionWaitingList({ items, alwaysShow }: { items: readonly VisionWaitingItem[]; alwaysShow: boolean }): ReactNode {
  const { say } = useSay();
  const plant = usePlantUnits();
  const headingId = useId();
  if (items.length === 0 && !alwaysShow) return null;
  return (
    <section aria-labelledby={headingId} data-testid="vision-waiting" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <h2 id={headingId} className="m-0 text-[16px] font-semibold">
        {say("ingest.vision.waiting.title")}
      </h2>
      {items.length === 0 ? (
        <Muted>{say("ingest.vision.waiting.empty")}</Muted>
      ) : (
        <>
          <Muted>{say("ingest.vision.waiting.lead")}</Muted>
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {items.map((item) => (
              <li key={item.candidateId} data-testid="vision-waiting-item" className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-medium break-words">{item.title && item.title.trim() !== "" ? `${item.title}, ${item.fileName}` : item.fileName}</span>
                  <span className="text-[14px] leading-5 text-muted-foreground">
                    {say("ingest.vision.waiting.line", { page: item.page, count: item.pageCount })} · {say("ingest.file.rows", { count: plant.count(item.rows) })}
                  </span>
                  {item.needsPrices ? <span className="text-[14px] leading-5 font-medium text-tone-amber-ink">{say("ingest.vision.error.needsPrices")}</span> : null}
                </div>
                <UiLink
                  to={`/ingest/review/${item.candidateId}`}
                  aria-label={say("ingest.vision.waiting.openLabel", { file: item.fileName, page: item.page })}
                  className="inline-flex min-h-11 items-center self-start font-semibold underline underline-offset-4 sm:self-center"
                >
                  {say("ingest.vision.waiting.open")}
                </UiLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The waiting list as a query, for the Imports page of everyone who holds `ingest.check`. */
export function VisionWaitingPanel({ alwaysShow }: { alwaysShow: boolean }): ReactNode {
  const waiting = useVisionWaiting();
  return <QueryPanel query={waiting}>{waiting.data ? <VisionWaitingList items={waiting.data} alwaysShow={alwaysShow} /> : null}</QueryPanel>;
}

/** `/ingest` for a check-only person: the page header and the list, nothing to upload or merge. */
export function IngestCheckListScreen(): ReactNode {
  const { t } = useT();
  useEffect(() => {
    document.title = t("ingest.docTitle.list");
  }, [t]);
  return (
    <>
      <PageHeader title={t("ingest.title")} subtitle={t("ingest.vision.waiting.lead")} />
      <VisionWaitingPanel alwaysShow />
    </>
  );
}

/** `/ingest/review/$id` for a check-only person: the page check of a model-read table and its tick, read only. */
export function IngestCheckReviewScreen({ candidateId }: { candidateId: string }): ReactNode {
  const { t, say } = useSay();
  const candidate = useCandidate(candidateId);
  const data = candidate.data;
  useEffect(() => {
    document.title = data ? reviewDocTitle(say, data) : t("ingest.docTitle.list");
  }, [data, say, t]);
  return (
    <>
      <PageHeader back={{ to: "/ingest", label: t("ingest.title") }} title={data ? checkTitle(t, data) : t("ingest.title")} subtitle={data?.fileName} />
      <QueryPanel query={candidate}>{data ? <CheckReviewBody candidate={data} /> : null}</QueryPanel>
    </>
  );
}

function checkTitle(t: ReturnType<typeof useSay>["t"], c: CandidateDetail): string {
  const header = reviewHeader(c);
  if (header.title.kind === "target") return t(header.title.key as never);
  if (header.title.kind === "sheet") return header.title.name;
  return t("ingest.list.newTable");
}

export function CheckReviewBody({ candidate }: { candidate: CandidateDetail }): ReactNode {
  const { say } = useSay();
  if (!blockVisionOf(candidate.block) || candidate.state === "discarded") {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState title={say("settings.data.noAccess")} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Muted>{say("ingest.vision.checkOnlyLead")}</Muted>
      <VisionCheckPanel candidate={candidate} approveBusy={false} approveWorking={false} onApprove={() => {}} tickRef={() => {}} />
    </div>
  );
}
