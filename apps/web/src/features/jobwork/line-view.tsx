import type { ProcessKind } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { RegisterView } from "./register-view";

/** What is on this kind of step now: steps and bundles. Open and part-back steps only. */
export function OnNowChips({ kind }: { kind: ProcessKind }) {
  const { t } = useT();
  const open = useQuery({ ...trpc.process.steps.list.queryOptions({ kind, status: "open", limit: 200 }), refetchInterval: 60_000, meta: INLINE_ERROR_META });
  const partial = useQuery({ ...trpc.process.steps.list.queryOptions({ kind, status: "partial", limit: 200 }), refetchInterval: 60_000, meta: INLINE_ERROR_META });
  if (!open.data || !partial.data) return null;
  const rows = [...open.data.items, ...partial.data.items];
  const steps = rows.length;
  const bundles = rows.reduce((n, r) => n + r.bundlesOut, 0);
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t("jw.line.now")} data-testid="on-now">
      <li>
        <Chip tone={steps > 0 ? "amber" : "neutral"} truncate={false}>
          {t("jw.line.steps", { count: steps })}
        </Chip>
      </li>
      <li>
        <Chip tone="neutral" truncate={false}>
          {t("jw.line.bundles", { count: bundles })}
        </Chip>
      </li>
    </ul>
  );
}

/** The in-house finishing line tab: what is on the line now, a Start button for people who run it, and the finish steps. */
export function LineView() {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <OnNowChips kind="finish" />
        <Can do="process.run">
          <Button asChild variant="secondary">
            <UiLink to="/jobwork/new" className="no-underline" data-testid="start-line-step">
              <Plus aria-hidden="true" className="size-4" />
              {t("jw.action.startStep")}
            </UiLink>
          </Button>
        </Can>
      </div>
      <RegisterView
        fixedKind="finish"
        empty={
          <Can do="process.run">
            <Button asChild>
              <UiLink to="/jobwork/new" className="no-underline">
                {t("jw.action.startStep")}
              </UiLink>
            </Button>
          </Can>
        }
      />
    </div>
  );
}
