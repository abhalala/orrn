import { useT } from "@orrn/i18n";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { UiLink } from "@orrn/ui/components/link";

/** `dashboard.today.toolingShort` (XE ADM #62): tooling types held below the plant's minimum. Empty for most people. */
export type ToolingShort = { type: string; held: number; min: number }[];

/**
 * Today's tooling tile: one amber block per tooling type below its minimum, "{held} of {min}", each opening
 * the tooling list. Renders nothing when no type is short.
 */
export function TodayToolingTile({ short }: { short: ToolingShort | undefined }) {
  const { t } = useT();
  if (!short || short.length === 0) return null;
  return (
    <section aria-labelledby="today-tooling" data-testid="today-tooling" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-tooling" className="m-0 text-[17px] font-semibold">
          {t("adm.floor.today.title")}
        </h2>
        <UiLink to="/masters/tooling" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
          {t("adm.floor.today.open")}
        </UiLink>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {short.map((row) => (
          <StatusBlock
            key={row.type}
            tone="amber"
            title={t(`adm.tooling.${row.type}` as "adm.tooling.other")}
            meta={t("adm.floor.today.meta")}
            value={t("adm.floor.today.of", { held: row.held, min: row.min })}
            mono={false}
            href="/masters/tooling"
          />
        ))}
      </div>
    </section>
  );
}
