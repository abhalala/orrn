export type ImpersonationBannerProps = {
  companyName?: string | null;
  onStop: () => void;
  stopLabel?: string;
};

/**
 * Shared sticky banner used on web any time the request context shows we're
 * inside an impersonation session. Red tone block (white text >= 4.5:1 on
 * the lighter stop). Native uses the `.native.tsx` counterpart.
 */
export function ImpersonationBanner({
  companyName,
  onStop,
  stopLabel = "Stop",
}: ImpersonationBannerProps) {
  return (
    <div
      role="status"
      className="flex w-full flex-row items-center justify-between gap-3 bg-[linear-gradient(160deg,var(--tone-red-from),var(--tone-red-to))] px-4 py-2 text-tone-red-on"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-sm font-bold">Impersonating</span>
        <p className="m-0 min-w-0 text-sm">
          {companyName ?? "this company"}. Every action is audited.
        </p>
      </div>
      <button
        type="button"
        onClick={onStop}
        className="inline-flex h-9 shrink-0 items-center rounded-full bg-tone-red-on px-4 text-[13px] font-semibold text-tone-red-to transition-transform duration-[var(--dur-fast)] hover:opacity-95 active:scale-[0.97] focus-visible:outline-tone-red-on pointer-coarse:h-11"
      >
        {stopLabel}
      </button>
    </div>
  );
}
