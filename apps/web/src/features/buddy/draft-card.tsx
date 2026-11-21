import { useT, type MessageKey, type Translate } from "@orrn/i18n";
import { mapSentence } from "@orrn/i18n/refusal";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { useId, useState } from "react";

import { Can } from "@/shared/components/can";

import type { BuddyDraft, DraftField, DraftStatus } from "./types";

const TONE: Record<DraftStatus, "amber" | "green" | "neutral" | "red"> = {
  pending: "amber",
  confirmed: "green",
  rejected: "neutral",
  expired: "neutral",
  failed: "red",
};

/**
 * Where a draft's review link may take the person: only an in-app import page (`/ingest/...`), as a path. A full URL
 * on this same web host becomes its path; anything else (another host, a script URL) gets no link at all.
 */
export function reviewPath(link: string | null | undefined, origin = typeof window === "undefined" ? "http://orrn.invalid" : window.location.origin): string | null {
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (!/^\/ingest\/(review|files)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
  return url.pathname + url.search;
}

/** A refusal stored on a failed draft is the server's English sentence: say it in the person's language. */
export function failureText(t: Translate, failure: string | null): string {
  if (!failure) return t("refusal.unknown");
  const hit = mapSentence(failure, t);
  return hit ? t(hit.key, hit.vars) : t("refusal.unknown");
}

/** A result is shown only when it is a short line of text or a number; anything bigger stays on its own screen. */
function resultText(result: unknown): string | null {
  if (typeof result === "number") return String(result);
  if (typeof result === "string" && result.trim() && result.length <= 120) return result.trim();
  return null;
}

export type DraftCardProps = {
  draft: BuddyDraft;
  when: (at: string | number | Date) => string;
  /** Which decision is on its way to the server for this card. */
  pending?: "confirm" | "reject" | null;
  /** The last Confirm or Reject failed: already in the person's words. */
  error?: string | null;
  onConfirm(draft: BuddyDraft): void;
  onReject(draft: BuddyDraft): void;
  /** The person follows the review link (the panel steps aside so the page can be used). */
  onLeave?(): void;
  /** A confirmed row-check draft this surface is driving (the bubble only); null or absent elsewhere. */
  drive?: DriveView | null;
  onStopDrive?(draft: BuddyDraft): void;
};

/** The row check a confirmed `import.runDryRun` draft runs in the bubble (fix round decision 8). */
export type DriveView = {
  phase: "starting" | "running" | "otherTab" | "done" | "stopped" | "failed";
  done: number | null;
  total: number | null;
};

/** Import drafts whose title the app says in the person's language (§12.1); every other draft shows the server's words. */
const TITLE_KEYS = {
  "ingest.shape.make": "buddy.draft.titles.ingest_shape_make",
  "ingest.period.confirm": "buddy.draft.titles.ingest_period_confirm",
  "ingest.answer.set": "buddy.draft.titles.ingest_answer_set",
  "ingest.rows.answerDoubts": "buddy.draft.titles.ingest_rows_answerDoubts",
  "ingest.candidate.confirmNear": "buddy.draft.titles.ingest_candidate_confirmNear",
  "ingest.candidate.setTarget": "buddy.draft.titles.ingest_candidate_setTarget",
  "ingest.candidate.hold": "buddy.draft.titles.ingest_candidate_hold",
  "ingest.candidate.release": "buddy.draft.titles.ingest_candidate_release",
  "ingest.dryRun.step": "buddy.draft.titles.ingest_dryRun_step",
  "ingest.vision.readPage": "buddy.draft.titles.ingest_vision_readPage",
  "import.answerQuestions": "buddy.draft.titles.import_answerQuestions",
  "import.runDryRun": "buddy.draft.titles.import_runDryRun",
} as const satisfies Record<string, MessageKey>;

/** Input keys the card names in the person's language (decision 9). Any other key shows the server's own label. */
const FIELD_KEYS = {
  candidateId: "buddy.field.candidateId",
  artifactId: "buddy.field.artifactId",
  target: "buddy.field.target",
  accept: "buddy.field.accept",
  fy: "buddy.field.fy",
  asOf: "buddy.field.asOf",
  questionCode: "buddy.field.questionCode",
  subject: "buddy.field.subject",
  answer: "buddy.field.answer",
  answers: "buddy.field.answers",
  rowId: "buddy.field.rowId",
  rowIds: "buddy.field.rowIds",
  expectCount: "buddy.field.expectCount",
  decision: "buddy.field.decision",
  matchId: "buddy.field.matchId",
  reason: "buddy.field.reason",
  pageId: "buddy.field.pageId",
  page: "buddy.field.page",
  name: "buddy.field.name",
  customerId: "buddy.field.customerId",
  vendorId: "buddy.field.vendorId",
  dieId: "buddy.field.dieId",
  sectionId: "buddy.field.sectionId",
  orderId: "buddy.field.orderId",
  lineId: "buddy.field.lineId",
  bundleId: "buddy.field.bundleId",
  serial: "buddy.field.serial",
  serials: "buddy.field.serials",
  quantity: "buddy.field.quantity",
  note: "buddy.field.note",
  notes: "buddy.field.notes",
  rows: "buddy.field.rows",
} as const satisfies Record<string, MessageKey>;

/** The name of an input field: the app's word for a known key (own keys only: the key comes from Hermes), else the server's label. */
export function fieldLabel(t: Translate, field: Pick<DraftField, "key" | "label">): string {
  return Object.prototype.hasOwnProperty.call(FIELD_KEYS, field.key) ? t(FIELD_KEYS[field.key as keyof typeof FIELD_KEYS]) : field.label;
}

/** A value longer than this shows its start until the person presses Show all. */
export const VALUE_PREVIEW = 160;
/** A list longer than this shows its first entries and "This runs N lines" until Show all. */
export const ITEM_PREVIEW = 5;

/** Whether the card hides anything until Show all: then Confirm waits for it (no silent cutting, decision 9). */
export function needsShowAll(draft: Pick<BuddyDraft, "fields" | "items">): boolean {
  if (draft.fields.some((f) => f.value.length > VALUE_PREVIEW)) return true;
  const items = draft.items ?? [];
  return items.length > ITEM_PREVIEW || items.some((i) => i.value.length > VALUE_PREVIEW || i.label.length > VALUE_PREVIEW);
}

const preview = (text: string, all: boolean) => (all || text.length <= VALUE_PREVIEW ? text : `${text.slice(0, VALUE_PREVIEW)}...`);

export function draftTitle(t: Translate, draft: { path: string; title: string }): string {
  const key = Object.prototype.hasOwnProperty.call(TITLE_KEYS, draft.path) ? TITLE_KEYS[draft.path as keyof typeof TITLE_KEYS] : null;
  return key ? t(key) : draft.title;
}

/**
 * One change Buddy prepared (design §4.4): the procedure in words, the input as a list, and Confirm and Reject for a
 * pending one. Confirm runs the real procedure under the person's own session; the server judges it again.
 */
export function DraftCard({ draft, when, pending = null, error = null, onConfirm, onReject, onLeave, drive = null, onStopDrive }: DraftCardProps) {
  const { t } = useT();
  const link = reviewPath(draft.link);
  const titleId = `buddy-draft-${draft.id}`;
  const gateId = useId();
  const result = draft.status === "confirmed" ? resultText(draft.result) : null;
  const hides = needsShowAll(draft);
  const [showAll, setShowAll] = useState(false);
  // Once everything was on screen, Confirm stays open even if the person folds the list again.
  const [seenAll, setSeenAll] = useState(false);
  const all = showAll || !hides;
  const items = draft.items ?? [];
  const shownItems = all ? items : items.slice(0, ITEM_PREVIEW);
  const gated = draft.status === "pending" && hides && !seenAll;
  return (
    <article
      aria-labelledby={titleId}
      data-testid="buddy-draft"
      data-draft-id={draft.id}
      data-status={draft.status}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-3.5"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="m-0 min-w-0 flex-1 basis-40 text-[15px] leading-6 font-semibold break-words">
          {draftTitle(t, draft)}
        </h3>
        <Chip tone={TONE[draft.status]} truncate={false}>
          {t(`buddy.draft.status.${draft.status}`)}
        </Chip>
      </div>
      {draft.origin === "chat" ? (
        <p className="m-0 text-[13px] text-muted-foreground" data-testid="buddy-draft-origin" data-origin="chat">
          {t("buddy.draft.origin.chat")}
        </p>
      ) : draft.origin === "other" ? (
        <p className="m-0 rounded-card bg-tone-amber-tint px-3 py-2 text-[13px] leading-5 text-tone-amber-ink" data-testid="buddy-draft-origin" data-origin="other">
          {t("buddy.draft.origin.other")}
        </p>
      ) : null}
      {draft.fields.length > 0 ? (
        <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[14px] leading-5" data-testid="buddy-draft-fields">
          {draft.fields.map((field, i) => (
            <div key={`${field.key}-${i}`} className="contents">
              <dt className="text-muted-foreground break-words">{fieldLabel(t, field)}</dt>
              <dd className="m-0 min-w-0 font-medium whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="buddy-draft-value">
                {preview(field.value, all)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {items.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="m-0 text-[13px] font-semibold text-muted-foreground" data-testid="buddy-draft-items-count">
            {t("buddy.draft.itemsSummary", { count: items.length })}
          </p>
          <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] leading-5" data-testid="buddy-draft-items">
            {shownItems.map((item, i) => (
              <li key={i} className="min-w-0 rounded-input bg-surface-sunken px-2.5 py-1.5" data-testid="buddy-draft-item">
                <span className="text-muted-foreground [overflow-wrap:anywhere]">{preview(item.label, all)}</span>{" "}
                <span className="font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">{preview(item.value, all)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {hides ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          aria-expanded={showAll}
          onClick={() => {
            setShowAll((v) => !v);
            setSeenAll(true);
          }}
          data-testid="buddy-draft-show-all"
        >
          {showAll ? t("buddy.draft.showLess") : t("buddy.draft.showAll")}
        </Button>
      ) : null}
      {draft.status === "pending" ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("buddy.draft.expires", { time: when(draft.expiresAt) })}</p>
      ) : null}
      {result ? <p className="m-0 text-[14px] break-words">{t("buddy.draft.result", { result })}</p> : null}
      {draft.status === "failed" ? (
        <p className="m-0 text-[14px] text-destructive break-words">{t("buddy.draft.failedWhy", { reason: failureText(t, draft.failure) })}</p>
      ) : null}
      {/* The row check: while the server says it waits for the browser, or after this surface ran it (final words). */}
      {draft.drive || drive ? <DriveLine draft={draft} drive={drive} onStop={onStopDrive} /> : null}
      {link ? (
        <UiLink
          to={link}
          onClick={onLeave}
          data-testid="buddy-draft-review"
          className="self-start text-[14px] font-semibold text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
        >
          {t("buddy.draft.review")}
        </UiLink>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-[14px] text-destructive break-words">
          {error}
        </p>
      ) : null}
      {draft.status === "pending" ? (
        <Can do="buddy.use">
          {gated ? (
            <p id={gateId} className="m-0 text-[13px] text-muted-foreground" data-testid="buddy-draft-gate">
              {t("buddy.draft.showAllFirst")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={pending === "confirm"}
              disabled={pending !== null || gated}
              aria-describedby={gated ? gateId : undefined}
              onClick={() => onConfirm(draft)}
              data-testid="buddy-draft-confirm"
            >
              {t("buddy.draft.confirm")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={pending === "reject"}
              disabled={pending !== null}
              onClick={() => onReject(draft)}
              data-testid="buddy-draft-reject"
            >
              {t("buddy.draft.reject")}
            </Button>
          </div>
        </Can>
      ) : null}
    </article>
  );
}

/** Progress of a confirmed row check: driven here in the bubble, or a pointer to the bubble from Settings. */
function DriveLine({ draft, drive, onStop }: { draft: BuddyDraft; drive: DriveView | null; onStop?(draft: BuddyDraft): void }) {
  const { t } = useT();
  if (!drive) {
    return (
      <p className="m-0 text-[14px] text-muted-foreground" data-testid="buddy-drive" data-phase="elsewhere">
        {t("buddy.draft.drive.inBubble")}
      </p>
    );
  }
  const running = drive.phase === "starting" || drive.phase === "running" || drive.phase === "otherTab";
  const text =
    drive.phase === "starting"
      ? t("buddy.draft.drive.starting")
      : drive.phase === "otherTab"
        ? t("buddy.draft.drive.otherTab")
        : drive.phase === "running"
          ? drive.total !== null && drive.done !== null
            ? t("buddy.draft.drive.running", { done: drive.done, total: drive.total })
            : t("buddy.draft.drive.runningNoTotal")
          : t(`buddy.draft.drive.${drive.phase}`);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="buddy-drive" data-phase={drive.phase}>
      {running && drive.total ? (
        <progress
          className="h-2 w-full overflow-hidden rounded-full accent-foreground"
          value={drive.done ?? 0}
          max={drive.total}
          aria-label={t("buddy.draft.drive.runningNoTotal")}
        />
      ) : null}
      <p role="status" className={drive.phase === "failed" ? "m-0 text-[14px] text-destructive" : "m-0 text-[14px]"}>
        {text}
      </p>
      {running && onStop ? (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => onStop(draft)} data-testid="buddy-drive-stop">
          {t("buddy.draft.drive.stop")}
        </Button>
      ) : null}
    </div>
  );
}
