import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";

import { allowedActions, useIngestActions, type CandidateSummary, type FileGroup } from "../lib";
import { FileName, useSay, type RowControls } from "./list-kit";
import { ActionError } from "./shared";

/**
 * The heading row of one file on the list (work order 3.2): the file name at 14 px semibold, "3 tables, added 11 Nov"
 * muted beside it, and "Approve all N" on the right when the file qualifies. The imports of the file follow under it,
 * inside the one card that holds every file (`ImportGroups`).
 */
export function FileGroupHeading({
  group,
  controls,
  onApproveAll,
}: {
  group: FileGroup;
  controls: RowControls;
  onApproveAll: (group: FileGroup) => void;
}) {
  const { say, words } = useSay();
  return (
    <div data-testid="ingest-file-group" className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-x-3">
        <h2 className="m-0 min-w-0 text-[13px] font-semibold text-foreground sm:text-[14px]">
          <FileName name={group.fileName} className="text-[13px] font-semibold sm:text-[14px]" />
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">{words(group.summary)}</p>
      </div>
      {group.approveAll ? (
        <Button
          variant="ghost"
          aria-label={`${say("ingest.action.approveAll", { count: group.approveAll.count })}: ${group.fileName}`}
          aria-disabled={controls.busy || undefined}
          onClick={() => {
            if (!controls.busy) onApproveAll(group);
          }}
        >
          {say("ingest.action.approveAll", { count: group.approveAll.count })}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Approve, Hold and Discard as the old review screen draws them. The rebuilt review screen has its own decision bar
 * and does not use this; it stays only so that screen compiles until it is replaced. Delete it with that screen.
 */
export function CandidateActions({ candidate, onDone }: { candidate: CandidateSummary; onDone?: () => void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const actions = useIngestActions();
  const [pending, setPending] = useState<"approve" | "hold" | "discard" | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const allowed = allowedActions(candidate, { merge: can(me, "ingest.merge"), upload: can(me, "ingest.upload") });

  const run = async (name: "approve" | "hold" | "discard") => {
    setPending(name);
    setFailed(null);
    try {
      await actions[name](candidate.id, candidate.serverSeq);
      onDone?.();
    } catch (error) {
      setFailed(error);
      onDone?.();
    } finally {
      setPending(null);
    }
  };

  if (!allowed.approve && !allowed.hold && !allowed.discard) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {allowed.approve ? (
          <Can do="ingest.merge">
            <Button size="sm" loading={pending === "approve"} disabled={pending !== null} onClick={() => void run("approve")}>
              {t("ingest.action.approve")}
            </Button>
          </Can>
        ) : null}
        {allowed.hold ? (
          <Can do={["ingest.upload", "ingest.merge"]}>
            <Button size="sm" variant="secondary" loading={pending === "hold"} disabled={pending !== null} onClick={() => void run("hold")}>
              {t("ingest.action.hold")}
            </Button>
          </Can>
        ) : null}
        {allowed.discard ? (
          <Can do="ingest.upload">
            <Button size="sm" variant="ghost" loading={pending === "discard"} disabled={pending !== null} onClick={() => void run("discard")}>
              {t("ingest.action.discard")}
            </Button>
          </Can>
        ) : null}
      </div>
      <ActionError error={failed} />
    </div>
  );
}
