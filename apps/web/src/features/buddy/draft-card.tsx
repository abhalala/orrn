import { useT, type MessageKey, type Translate } from "@orrn/i18n";
import { mapSentence } from "@orrn/i18n/refusal";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { useId, useState } from "react";

import { Can } from "@/shared/components/can";

import { fieldLabel } from "./draft-card-fields";
import { storedDryRun } from "./dry-run-drive";
import type { BuddyDraft, ConfirmBlock, DraftField, DraftStatus } from "./types";

export { fieldLabel };

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

/**
 * The server refuses Confirm of a draft with `confirmBlock` set (`PRECONDITION_FAILED`, `meta.reason` CONFIRM_BLOCKED).
 * Known by its reason, so the card says it in the person's language whatever the English words are.
 */
export function isConfirmBlocked(error: unknown): boolean {
  const data = (error as { data?: { meta?: { reason?: unknown } } } | null)?.data;
  return data?.meta?.reason === "CONFIRM_BLOCKED";
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
  /**
   * "reading": the loop ended and the report is on its way; "done", "stopped", "failed": the outcome the server stored
   * (never the loop's own guess, delta round S2); "unknown": the report stored nothing the bubble could read.
   */
  phase: "starting" | "running" | "otherTab" | "reading" | "done" | "stopped" | "failed" | "unknown";
  done: number | null;
  total: number | null;
  /** The candidate's state word the server stored with the outcome. */
  state?: string | null;
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

/** An id field the server tried to name and could not: the raw id stays on the card with a "no name found" note. */
const unnamed = (field: DraftField) => field.ref !== null && field.ref !== undefined && field.ref.name === null;

/**
 * Why Confirm is off (delta round S4, D-L3): the server's `confirmBlock`, or, for a change that cannot be undone, the
 * same rule worked out here from the fields when the server sent none (an unnamed id first, then a marked field).
 */
export function confirmBlockOf(draft: Pick<BuddyDraft, "fields" | "irreversible" | "confirmBlock">): ConfirmBlock | null {
  if (draft.confirmBlock) return draft.confirmBlock;
  if (!draft.irreversible) return null;
  const noName = draft.fields.filter(unnamed).map((f) => f.key);
  if (noName.length > 0) return { reason: "unnamed_id", keys: noName };
  const marked = draft.fields.filter((f) => f.marked).map((f) => f.key);
  return marked.length > 0 ? { reason: "bidi", keys: marked } : null;
}

/** One sentence for the reason Confirm is off, naming the fields in the person's language. */
function blockText(t: Translate, block: ConfirmBlock, fields: readonly DraftField[]): string {
  const names = [...new Set(block.keys)].map((key) => fieldLabel(t, fields.find((f) => f.key === key) ?? { key, label: key })).join(", ");
  if (block.reason === "unnamed_id") return t("buddy.draft.blocked.unnamed_id", { fields: names });
  if (block.reason === "bidi") return t("buddy.draft.blocked.bidi", { fields: names });
  return t("buddy.draft.blocked.other");
}

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
  const blockId = useId();
  const result = draft.status === "confirmed" ? resultText(draft.result) : null;
  const hides = needsShowAll(draft);
  const [showAll, setShowAll] = useState(false);
  // Once everything was on screen, Confirm stays open even if the person folds the list again.
  const [seenAll, setSeenAll] = useState(false);
  const all = showAll || !hides;
  const items = draft.items ?? [];
  const shownItems = all ? items : items.slice(0, ITEM_PREVIEW);
  const gated = draft.status === "pending" && hides && !seenAll;
  const block = draft.status === "pending" ? confirmBlockOf(draft) : null;
  const blockedKeys = new Set(block?.reason === "unnamed_id" ? block.keys : []);
  const describedBy = [block ? blockId : null, gated ? gateId : null].filter(Boolean).join(" ") || undefined;
  const stored = draft.kind === "dryRun" && draft.status === "confirmed" ? storedDryRun(draft.result) : null;
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
              <dd className="m-0 flex min-w-0 flex-col gap-0.5">
                {/* The server's value as sent: a resolved name, or the raw id; never cleaned here (joiners stay). */}
                <span className="font-medium whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="buddy-draft-value">
                  {preview(field.value, all)}
                </span>
                {unnamed(field) || (blockedKeys.has(field.key) && !field.ref) ? (
                  <span className="text-[13px] text-tone-amber-ink" data-testid="buddy-draft-no-name">
                    {t("buddy.draft.noName")}
                  </span>
                ) : null}
                {field.marked ? (
                  <span className="text-[13px] text-tone-amber-ink" data-testid="buddy-draft-marked">
                    {t("buddy.draft.marked")}
                  </span>
                ) : null}
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
      {draft.drive || drive || stored ? <DriveLine draft={draft} drive={drive} onStop={onStopDrive} /> : null}
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
          {block ? (
            <p id={blockId} className="m-0 rounded-card bg-tone-amber-tint px-3 py-2 text-[13px] leading-5 text-tone-amber-ink" data-testid="buddy-draft-blocked" data-reason={block.reason}>
              {blockText(t, block, draft.fields)}
            </p>
          ) : null}
          {gated ? (
            <p id={gateId} className="m-0 text-[13px] text-muted-foreground" data-testid="buddy-draft-gate">
              {t("buddy.draft.showAllFirst")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={pending === "confirm"}
              disabled={pending !== null || gated || block !== null}
              aria-describedby={describedBy}
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
function DriveLine({ draft, drive: local, onStop }: { draft: BuddyDraft; drive: DriveView | null; onStop?(draft: BuddyDraft): void }) {
  const { t } = useT();
  // The outcome the server stored wins over anything this surface saw (delta round S2).
  const stored = draft.kind === "dryRun" && draft.status === "confirmed" ? storedDryRun(draft.result) : null;
  const drive: DriveView | null = stored ? { phase: stored.outcome, state: stored.state, done: local?.done ?? null, total: local?.total ?? null } : local;
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
  const ended = drive.phase === "done" || drive.phase === "stopped" || drive.phase === "failed";
  const state = ended && drive.state ? stateWord(t, drive.state) : null;
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
      <p role="status" className={drive.phase === "failed" || drive.phase === "unknown" ? "m-0 text-[14px] text-destructive" : "m-0 text-[14px]"}>
        {text}
      </p>
      {state ? (
        <p className="m-0 text-[13px] text-muted-foreground" data-testid="buddy-drive-state">
          {t("buddy.draft.drive.sheetState", { state })}
        </p>
      ) : null}
      {running && onStop ? (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => onStop(draft)} data-testid="buddy-drive-stop">
          {t("buddy.draft.drive.stop")}
        </Button>
      ) : null}
    </div>
  );
}

const SHEET_STATES = ["processing", "needs_shape", "needs_confirm", "ready", "held", "approved", "merging", "merged", "failed", "discarded"] as const;

/** The sheet's state in the person's language; a state this build does not know shows as the server sent it. */
function stateWord(t: Translate, state: string): string {
  return (SHEET_STATES as readonly string[]).includes(state) ? t(`buddy.draft.drive.states.${state as (typeof SHEET_STATES)[number]}`) : state;
}
