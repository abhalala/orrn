export type ImpersonationBannerProps = {
  companyName?: string | null;
  onStop: () => void;
  stopLabel?: string;
};

/**
 * Shared sticky red banner used on web any time the request context shows
 * we're inside an impersonation session. (Native uses the `.native.tsx`
 * counterpart.)
 */
export function ImpersonationBanner({
  companyName,
  onStop,
  stopLabel = "Stop",
}: ImpersonationBannerProps) {
  return (
    <div
      className="flex w-full flex-row items-center justify-between gap-3 px-4 py-2.5"
      style={{ backgroundColor: "#dc2626" }}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <span
          className="text-xs font-bold uppercase"
          style={{ color: "#ffffff", letterSpacing: "0.06em" }}
        >
          Impersonating
        </span>
        <p className="m-0 text-sm" style={{ color: "#ffffff" }}>
          {companyName ?? "tenant"} — every action is audited.
        </p>
      </div>
      <button
        type="button"
        onClick={onStop}
        className="rounded-md border border-white bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-rose-100"
        style={{ color: "#b91c1c" }}
      >
        {stopLabel}
      </button>
    </div>
  );
}
