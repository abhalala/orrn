import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { stretchedLink } from "@orrn/ui/components/list-card";
import { ArrowDown, ArrowUp, Flame, Undo2 } from "lucide-react";
import type { MessageKey } from "@orrn/i18n";

import { Can } from "@/shared/components/can";

import { kgFromG } from "./model";
import type { QueueCard, QueueLine } from "./types";

const STATUS_TONE: Record<string, "amber" | "blue" | "green" | "neutral" | "red"> = {
  queued: "amber",
  die_issued: "blue",
  running: "green",
  stopped: "amber",
  counting: "blue",
  logged: "green",
  voided: "neutral",
};

export function statusTone(status: string) {
  return STATUS_TONE[status] ?? "neutral";
}

/** One cut length of a job: sales order number, customer, length x pieces, kg. */
function LineRow({ line, formatLength, onPullBack, canPullBack }: { line: QueueLine; formatLength: (mm: number) => string; onPullBack?: () => void; canPullBack: boolean }) {
  const { t } = useT();
  return (
    <li className="relative flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="min-w-0 flex-1 basis-[11rem]">
        <span className="font-mono text-[14px] font-semibold">{line.orderNumber}</span>
        <span className="text-[14px] text-muted-foreground"> {line.customerName}</span>
      </span>
      <span className="whitespace-nowrap text-[14px] tabular-nums">
        {formatLength(line.cutLengthMm)} × {line.pcs} {t("units.pcs")} · {kgFromG(line.kgG)} {t("units.kg")}
      </span>
      {canPullBack && onPullBack ? (
        <Can do="press.queue">
          <Button variant="ghost" size="md" onClick={onPullBack} aria-label={`${t("press.plan.pullBack")}: ${line.orderNumber} ${formatLength(line.cutLengthMm)}`}>
            <Undo2 aria-hidden="true" className="size-4" />
            <span className="max-sm:sr-only">{t("press.plan.pullBack")}</span>
          </Button>
        </Can>
      ) : null}
    </li>
  );
}

/**
 * The job card of one die across parties (rank 31): the die copy, every order line with its sales
 * order number (never a nickname), cut length, pieces and kg, the total, and what has been pressed
 * so far. The waiting ones carry the queue controls for press.queue holders (rank 44).
 */
export function JobCard({
  card,
  formatLength,
  position,
  waitingCount,
  busy,
  onMove,
  onUrgent,
  onPullBack,
}: {
  card: QueueCard;
  formatLength: (mm: number) => string;
  /** 1-based place in the waiting list; null for a run already on the press. */
  position: number | null;
  waitingCount: number;
  busy?: boolean;
  onMove?: (dir: "up" | "down") => void;
  onUrgent?: (urgent: boolean) => void;
  onPullBack?: (line: QueueLine) => void;
}) {
  const { t } = useT();
  const purpose = card.purpose !== "production" ? (`press.plan.purpose.${card.purpose}` as MessageKey) : null;
  const reorderable = card.reorderable;
  const canPull = reorderable && card.lines.length > 1;
  return (
    <article
      data-slot="job-card"
      data-run={card.number}
      data-status={card.status}
      className="relative flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="m-0 font-mono text-[20px] font-semibold leading-tight tabular-nums">
            <UiLink to={`/press/runs/${card.id}`} className={stretchedLink}>
              {card.number}
            </UiLink>
          </h3>
          <p className="m-0 mt-1 text-[15px] font-semibold">
            {card.sectionCode}
            <span className="font-normal text-muted-foreground"> {card.sectionName}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {position !== null ? <span className="text-[13px] text-muted-foreground">{t("press.console.queuePosition", { n: position })}</span> : null}
          {card.urgent ? (
            <Chip tone="red" truncate={false}>
              {t("press.queue.urgent")}
            </Chip>
          ) : null}
          {purpose ? (
            <Chip tone="neutral" truncate={false}>
              {t(purpose)}
            </Chip>
          ) : null}
          <Chip tone={statusTone(card.status)} truncate={false}>
            {t(`press.console.status.${card.status}` as MessageKey)}
          </Chip>
        </div>
      </header>

      <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{t("press.queue.dieCopy")}</dt>
          <dd className="m-0 mt-0.5 text-[15px]">
            {card.copyCode ? <span className="font-mono">{card.copyCode}</span> : t("press.queue.dieNotIssued")}
            {card.bolster ? <span className="text-muted-foreground"> · {t("press.queue.bolster", { no: card.bolster })}</span> : null}
          </dd>
        </div>
      </dl>

      {card.lines.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="m-0 text-xs font-medium text-muted-foreground">{t("press.queue.released")}</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {card.lines.map((line) => (
              <LineRow key={line.id} line={line} formatLength={formatLength} canPullBack={canPull} onPullBack={onPullBack ? () => onPullBack(line) : undefined} />
            ))}
          </ul>
          <p className="m-0 border-t border-border pt-2 text-[14px] font-semibold tabular-nums">
            {t("press.queue.total")}: {card.totals.pcs} {t("units.pcs")} · {kgFromG(card.totals.kgG)} {t("units.kg")}
            {card.totals.pressedG > 0 ? (
              <span className="font-normal text-muted-foreground"> · {t("press.queue.pressedSoFar", { kg: kgFromG(card.totals.pressedG) })}</span>
            ) : null}
          </p>
        </div>
      ) : (
        <p className="m-0 text-[14px] text-muted-foreground">
          {t("press.queue.noOrderLines")}. {t("press.queue.purposeNote")}
        </p>
      )}

      {reorderable && position !== null && onMove ? (
        <Can do="press.queue">
          <div className="relative flex flex-wrap gap-2 border-t border-border pt-3" role="group" aria-label={t("press.plan.queueOrder")}>
            <Button variant="secondary" size="md" disabled={busy || position <= 1} onClick={() => onMove("up")} aria-label={`${t("press.plan.moveUp")}: ${card.number}`}>
              <ArrowUp aria-hidden="true" className="size-4" />
              {t("press.plan.moveUp")}
            </Button>
            <Button variant="secondary" size="md" disabled={busy || position >= waitingCount} onClick={() => onMove("down")} aria-label={`${t("press.plan.moveDown")}: ${card.number}`}>
              <ArrowDown aria-hidden="true" className="size-4" />
              {t("press.plan.moveDown")}
            </Button>
            {onUrgent ? (
              <Button variant="ghost" size="md" disabled={busy} onClick={() => onUrgent(!card.urgent)} aria-pressed={card.urgent}>
                <Flame aria-hidden="true" className="size-4" />
                {card.urgent ? t("press.queue.clearUrgent") : t("press.queue.markUrgent")}
              </Button>
            ) : null}
          </div>
        </Can>
      ) : null}
    </article>
  );
}
