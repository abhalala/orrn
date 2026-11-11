import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";

import { plantTimeText } from "@/features/approvals/approval-view";

import { useCompanyTimeZone } from "./hooks";

/** Arch 52: a completed dispatch entered late says so, with the time the truck left and why. */
export function LateEntryNote({ dispatch }: { dispatch: { lateEntry?: boolean | null; lateEntryReason?: string | null; completedAt?: string | Date | null } }) {
  const { t } = useT();
  const tz = useCompanyTimeZone();
  if (!dispatch.lateEntry || !dispatch.completedAt) return null;
  const at = new Date(dispatch.completedAt).getTime();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="late-entry-note">
      <Chip tone="amber">{t("dispatch.late.chip")}</Chip>
      <span className="min-w-0 text-[15px] break-words text-muted-foreground">
        {t("dispatch.late.left", { when: plantTimeText(at, tz), reason: dispatch.lateEntryReason ?? "" })}
      </span>
    </div>
  );
}
