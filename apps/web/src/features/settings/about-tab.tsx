import { useT } from "@orrn/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useMe } from "@/shared/lib/me";
import { WEB_BUILD } from "@/shared/lib/build-info";

import { supportContactOf } from "./model";

function Fact({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[15px] break-words" : "m-0 text-[15px] break-words"}>{value}</dd>
    </div>
  );
}

/**
 * About: the web app's version and build day, who is signed in to which plant, and the plant's
 * support contact (`settings.support`, read as stored). With no contact set it points to Help.
 */
export function AboutTab() {
  const { t } = useT();
  const { data: me } = useMe();
  const company = me?.company;
  const contact = supportContactOf(company?.settings);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="settings-about">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.about.app")}</CardTitle>
          <CardDescription>in.orrn.app</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label={t("settings.about.version")} value={`${WEB_BUILD.version} (${WEB_BUILD.date})`} mono />
            <Fact label={t("settings.about.plant")} value={company?.name ?? "-"} />
            <Fact label={t("settings.about.signedIn")} value={me?.user.email ?? "-"} />
            <Fact label={t("settings.about.role")} value={company ? t(`roles.${company.role}`) : "-"} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.about.support")}</CardTitle>
        </CardHeader>
        <CardContent>
          {contact ? (
            <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="support-contact">
              {contact.name ? <Fact label={t("settings.about.support")} value={contact.name} /> : null}
              {contact.phone ? <Fact label={t("plantSettings.letterhead.phone")} value={contact.phone} mono /> : null}
              {contact.email ? <Fact label={t("settings.team.email")} value={contact.email} /> : null}
              {contact.hours ? <Fact label={t("settings.about.hoursLabel")} value={contact.hours} /> : null}
            </dl>
          ) : (
            <p className="m-0 text-[15px] leading-6 text-muted-foreground" data-testid="support-contact-none">
              {t("settings.about.supportNone")}
            </p>
          )}
          <div className="flex flex-wrap gap-4 pt-1">
            <Link to="/settings" search={{ tab: "support" }} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              {t("settings.about.help")}
            </Link>
            <Link to="/guides" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              {t("settings.about.guides")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
