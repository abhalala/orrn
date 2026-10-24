/**
 * "More actions" menu for a page header: secondary actions such as Import CSV. Renders nothing
 * when the caller passes no items (for example, every item is gated away for this role).
 */
import { useT } from "@orrn/i18n";
import { IconButton } from "@orrn/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orrn/ui/components/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export type OverflowItem = { key: string; label: string; icon?: ReactNode; onSelect(): void; danger?: boolean };

export function OverflowMenu({ items }: { items: OverflowItem[] }) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="secondary" label={t("common.moreActions")} icon={<MoreHorizontal strokeWidth={2} />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            onSelect={item.onSelect}
            className={item.danger ? "min-h-11 text-[15px] text-destructive focus:text-destructive" : "min-h-11 text-[15px]"}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
