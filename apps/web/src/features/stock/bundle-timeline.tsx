import { bundleTone } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import type { TimelineEntry, TimelineKind } from "./timeline";
import { useCompanyWhen } from "./use-company-when";

const TITLE: Record<TimelineKind, MessageKey> = {
  packed: "bundle.historyPacked",
  imported: "bundle.historyImported",
  held: "bundle.historyHeld",
  released: "bundle.historyReleased",
  dispatched: "bundle.historyDispatched",
  voided: "bundle.historyVoided",
  restored: "bundle.historyRestored",
  changed: "bundle.historyChanged",
};

/** Status colour of the dot (static class names for Tailwind). */
const DOT = {
  green: "bg-tone-green",
  blue: "bg-tone-blue",
  amber: "bg-tone-amber",
  red: "bg-tone-red",
  neutral: "bg-tone-neutral-ink",
} as const;

/**
 * The bundle's history, newest first, as an ordered list: what happened in
 * floor words, when (company time), the reason someone typed, and a link to
 * the dispatch for holds and dispatches. The dot's colour repeats the status
 * the event led to; the words carry the meaning.
 */
export function BundleTimeline({
  entries,
  activeDispatch,
}: {
  entries: readonly TimelineEntry[];
  activeDispatch: { id: string; code: string } | null;
}) {
  const { t } = useT();
  const when = useCompanyWhen();

  return (
    <section aria-labelledby="bundle-history" className="flex min-w-0 flex-col gap-3">
      <h2 id="bundle-history" className="m-0 font-display text-[22px] font-bold leading-tight tracking-[-0.025em]">
        {t("bundle.history")}
      </h2>
      <ol data-testid="bundle-timeline" className="m-0 list-none rounded-card border border-border bg-card p-0">
        {entries.map((e, i) => {
          const last = i === entries.length - 1;
          const code = e.dispatchId && activeDispatch?.id === e.dispatchId ? activeDispatch.code : null;
          return (
            <li key={e.id} data-kind={e.kind} className="relative flex gap-3 px-4 py-3.5 sm:px-5">
              {/* Rail between dots; hidden from assistive tech. */}
              {!last ? (
                <span aria-hidden="true" className="absolute top-8 bottom-0 left-[21px] w-px bg-border sm:left-[25px]" />
              ) : null}
              <span
                aria-hidden="true"
                className={cn("relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-card", DOT[bundleTone(e.status)])}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="m-0 text-[15px] font-semibold leading-6 break-words">
                  {t(TITLE[e.kind], { status: t(`status.bundle.${e.status}`) })}
                </p>
                <p className="m-0 text-[13px] leading-5 text-muted-foreground tabular-nums">
                  <time dateTime={e.at.toISOString()}>{when(e.at)}</time>
                  {e.actorName ? <span data-slot="actor">{` · ${t("bundle.byActor", { name: e.actorName })}`}</span> : null}
                </p>
                {e.note ? (
                  <p className="m-0 text-[14px] leading-5 break-words">{t("bundle.reasonLine", { reason: e.note })}</p>
                ) : null}
                {e.dispatchId && (e.kind === "held" || e.kind === "dispatched") ? (
                  <Link
                    to="/dispatch/$id"
                    params={{ id: e.dispatchId }}
                    className="mt-0.5 inline-flex min-h-11 items-center self-start text-[14px] font-semibold text-foreground underline decoration-1 underline-offset-4 hover:decoration-2 pointer-fine:min-h-0"
                  >
                    {code ? t("bundle.openDispatch", { code }) : t("bundle.openDispatchPlain")}
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
