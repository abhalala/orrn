/**
 * Your data stays yours: company separation, the change log and roles, in
 * plain words. The heading stays in view (CSS sticky) while the three points
 * scroll past it on wide screens.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { History, ShieldCheck, UserCog, type LucideIcon } from "lucide-react";

const POINTS: { icon: LucideIcon; text: MessageKey }[] = [
  { icon: ShieldCheck, text: "marketing.trust.separate" },
  { icon: History, text: "marketing.trust.audit" },
  { icon: UserCog, text: "marketing.trust.roles" },
];

export function Trust() {
  const { t } = useT();
  return (
    <section id="trust" aria-labelledby="trust-title" className="orrn-section py-20 md:py-28">
      <div className="grid gap-10 border-t border-border pt-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:pt-16">
        <div className="min-w-0">
          <h2 id="trust-title" className="orrn-display-2 m-0 text-balance text-foreground md:sticky md:top-28">
            {t("marketing.trust.title")}
          </h2>
        </div>
        <ul className="m-0 flex list-none flex-col gap-10 p-0">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex min-w-0 flex-col gap-4">
              <Icon aria-hidden="true" className="size-8 text-foreground" strokeWidth={2} />
              <p className="m-0 max-w-[30rem] font-display text-[22px] font-semibold leading-snug tracking-[-0.02em] text-foreground md:text-[26px]">
                {t(text)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
