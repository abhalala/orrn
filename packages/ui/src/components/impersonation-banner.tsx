export type ImpersonationBannerProps = {
  companyName?: string | null;
  /** Translated sentence, e.g. "Viewing KD Extrusion as orrn support". Replaces the default copy. */
  message?: string;
  /** Second line, e.g. "Ends at 14:32". */
  detail?: string;
  onStop: () => void;
  stopLabel?: string;
  /** While the grant is being revoked: the button shows busy and ignores presses. */
  stopping?: boolean;
};

/**
 * Sticky banner on every signed-in web screen while orrn staff are inside a
 * company (an impersonation grant). Violet: the Godseye colour, so it reads
 * as "staff are here", never as an error. White text on the lighter violet
 * stop is >= 4.5:1 (tokens.test.ts). Native uses the `.native.tsx` twin.
 */
export function ImpersonationBanner({
  companyName,
  message,
  detail,
  onStop,
  stopLabel = "Stop",
  stopping = false,
}: ImpersonationBannerProps) {
  return (
    <div
      role="status"
      data-slot="impersonation-banner"
      className="flex w-full flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-[linear-gradient(160deg,var(--tone-violet-from),var(--tone-violet-to))] px-4 py-2 text-tone-violet-on"
    >
      <div className="flex min-w-0 flex-1 basis-56 flex-col">
        {message ? (
          <p className="m-0 min-w-0 text-sm font-semibold break-words">{message}</p>
        ) : (
          <p className="m-0 min-w-0 text-sm break-words">
            <span className="font-bold">Impersonating</span> {companyName ?? "this company"}. Every action is audited.
          </p>
        )}
        {detail ? <p className="m-0 text-[13px] font-medium tabular-nums">{detail}</p> : null}
      </div>
      <button
        type="button"
        onClick={stopping ? undefined : onStop}
        aria-busy={stopping || undefined}
        aria-disabled={stopping || undefined}
        className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-tone-violet-on px-4 text-[14px] font-semibold text-tone-violet-to transition-transform duration-[var(--dur-fast)] hover:opacity-95 active:scale-[0.97] focus-visible:outline-tone-violet-on aria-busy:cursor-progress aria-busy:opacity-80"
      >
        {stopLabel}
      </button>
    </div>
  );
}
