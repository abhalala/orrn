import { Button } from "@orrn/ui/components/button";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Chip } from "@orrn/ui/components/chip";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import type { DieRow } from "./hooks";
import { driftLine, dueLines, dueTone } from "./model";
import { Loaded, Note, useCostSay } from "./ui";

type Show = "attention" | "all";
const PAGE = 100;

/** Row 61: each die copy's nitriding and correction estimate, and its weight drift. "Show more" pages through every match. */
export function DiesTab() {
  const say = useCostSay();
  const { t } = say;
  const [show, setShow] = useState<Show>("attention");
  // One query per page; switching the list starts again from the first page.
  const [offsets, setOffsets] = useState<number[]>([0]);
  const choose = (next: Show) => {
    setShow(next);
    setOffsets([0]);
  };
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="dies-tab">
      <SegmentedControl<Show>
        label={t("cost.dies.show")}
        value={show}
        onChange={choose}
        options={[
          { value: "attention", label: t("cost.dies.attention") },
          { value: "all", label: t("cost.dies.all") },
        ]}
      />
      {offsets.map((offset, i) => (
        <DiesPage key={`${show}-${offset}`} show={show} offset={offset} first={i === 0} last={i === offsets.length - 1} onMore={(next) => setOffsets([...offsets, next])} />
      ))}
    </div>
  );
}

function DiesPage({ show, offset, first, last, onMore }: { show: Show; offset: number; first: boolean; last: boolean; onMore: (next: number) => void }) {
  const say = useCostSay();
  const { t } = say;
  const q = useQuery({ ...trpc.costing.dies.queryOptions({ state: show, limit: PAGE, offset }), meta: INLINE_ERROR_META });
  return (
    <Loaded query={q}>
      {(data) => (
        <>
          {first ? <Note>{t("cost.dies.summary", { due: data.due, soon: data.soon, copies: data.copies })}</Note> : null}
          {first && data.items.length === 0 ? (
            <Note>{t("cost.dies.empty")}</Note>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {data.items.map((r) => (
                <li key={r.copyId} className="rounded-card border border-border bg-card px-4 py-3" data-testid="die-copy">
                  <DieCard row={r} />
                </li>
              ))}
            </ul>
          )}
          {last && data.nextOffset != null ? (
            <div>
              <Button variant="secondary" onClick={() => onMore(data.nextOffset!)}>
                {t("cost.dies.showMore", { shown: Math.min(data.total, offset + data.items.length), total: data.total })}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Loaded>
  );
}

export function DieCard({ row }: { row: DieRow }) {
  const say = useCostSay();
  const { t } = say;
  const lines = { t, kg: say.kgU };
  const one = (label: string, e: DieRow["nitride"]) => (
    <div className="min-w-0">
      <p className="m-0 flex flex-wrap items-center gap-2 text-[14px] font-medium">
        {label}
        <Chip tone={dueTone(e.state)}>{t(`cost.dies.state.${e.state}`)}</Chip>
      </p>
      <ul className="m-0 list-none p-0 text-[13px] text-muted-foreground">
        {dueLines(e, lines).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="m-0 text-[15px] font-semibold">{t("cost.outlook.diesLine", { code: row.code, section: row.sectionCode })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {one(t("cost.dies.nitride"), row.nitride)}
        {one(t("cost.dies.correct"), row.correct)}
      </div>
      <p className="m-0 text-[13px]">
        <span className="font-medium">{t("cost.dies.drift")}: </span>
        {driftLine(row.drift, lines)}
      </p>
    </div>
  );
}
