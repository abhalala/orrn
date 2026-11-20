import { useT, type Translate } from "@orrn/i18n";
import { mapSentence } from "@orrn/i18n/refusal";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";

import { Can } from "@/shared/components/can";

import type { BuddyDraft, DraftStatus } from "./types";

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
};

/**
 * One change Buddy prepared (design §4.4): the procedure in words, the input as a list, and Confirm and Reject for a
 * pending one. Confirm runs the real procedure under the person's own session; the server judges it again.
 */
export function DraftCard({ draft, when, pending = null, error = null, onConfirm, onReject, onLeave }: DraftCardProps) {
  const { t } = useT();
  const link = reviewPath(draft.link);
  const titleId = `buddy-draft-${draft.id}`;
  const result = draft.status === "confirmed" ? resultText(draft.result) : null;
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
          {draft.title}
        </h3>
        <Chip tone={TONE[draft.status]} truncate={false}>
          {t(`buddy.draft.status.${draft.status}`)}
        </Chip>
      </div>
      {draft.lines.length > 0 ? (
        <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[14px] leading-5">
          {draft.lines.map((line, i) => (
            <div key={`${line.label}-${i}`} className="contents">
              <dt className="text-muted-foreground break-words">{line.label}</dt>
              <dd className="m-0 min-w-0 font-medium [overflow-wrap:anywhere]">{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {draft.status === "pending" ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("buddy.draft.expires", { time: when(draft.expiresAt) })}</p>
      ) : null}
      {result ? <p className="m-0 text-[14px] break-words">{t("buddy.draft.result", { result })}</p> : null}
      {draft.status === "failed" ? (
        <p className="m-0 text-[14px] text-destructive break-words">{t("buddy.draft.failedWhy", { reason: failureText(t, draft.failure) })}</p>
      ) : null}
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
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={pending === "confirm"}
              disabled={pending !== null}
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
