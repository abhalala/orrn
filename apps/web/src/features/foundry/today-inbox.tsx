import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

/**
 * Today, for the people who enter casts (foundry, supervisor): a chip that opens the spectro inbox,
 * with the number of files waiting for a melt (W4-MASTERS review I-5: the inbox was reachable only
 * from an admin-only Settings tab).
 */
export function TodaySpectroInbox() {
  const { t } = useT();
  const inbox = useQuery({ ...trpc.foundry.spectroInbox.list.queryOptions(), meta: INLINE_ERROR_META });
  const waiting = inbox.data?.length ?? 0;
  return (
    <p className="m-0 flex flex-wrap items-center gap-2" data-testid="today-spectro-inbox">
      <UiLink to="/casts/inbox" className="no-underline" data-testid="today-spectro-inbox-link">
        <Chip tone={waiting > 0 ? "amber" : "neutral"}>
          {waiting > 0 ? `${t("foundry.inbox.title")} · ${t("devices.collectors.inboxWaiting", { count: waiting })}` : t("foundry.inbox.title")}
        </Chip>
      </UiLink>
    </p>
  );
}
