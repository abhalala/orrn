import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { nodeTone } from "@/features/printing/model";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { PackingListScopeCard } from "./packing-list-scope";

/**
 * Printing defaults: the stored status of the plant's print computer with
 * its last heartbeat time, and each label printer's design and default
 * copies. Read-only: printers and designs are set up by the orrn team.
 */
export function PrintingTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const status = useQuery(trpc.spool.deploymentStatus.queryOptions());
  const profiles = useQuery(trpc.spool.listProfiles.queryOptions());

  if (status.isPending || profiles.isPending) {
    return <Skeleton className="h-40 w-full rounded-card" aria-busy="true" />;
  }
  if (status.isError || profiles.isError) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("settings.loadFailed")}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void status.refetch();
                void profiles.refetch();
              }}
            >
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const deployment = status.data;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="settings-printing">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("settings.printing.status")}</CardTitle>
            {deployment ? (
              <Chip tone={nodeTone(deployment.status)}>{t(`status.printSetup.${deployment.status}`)}</Chip>
            ) : (
              <Chip tone="neutral">{t("status.printSetup.none")}</Chip>
            )}
          </div>
          <CardDescription>{t("settings.printing.hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {deployment ? (
            <p className="m-0 text-[15px]">
              {deployment.lastSeenAt
                ? t("settings.printing.lastSeen", { time: when(deployment.lastSeenAt) })
                : t("settings.printing.neverSeen")}
            </p>
          ) : (
            <p className="m-0 text-[15px] text-muted-foreground">{t("printing.notSetUpBody")}</p>
          )}
        </CardContent>
      </Card>

      <PackingListScopeCard />

      <section aria-labelledby="label-defaults" className="flex min-w-0 flex-col gap-3">
        <h2 id="label-defaults" className="m-0 text-[17px] font-semibold">
          {t("settings.printing.defaults")}
        </h2>
        {profiles.data.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("settings.printing.defaultsEmpty")} />
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
            {profiles.data.map((profile) => (
              <li key={profile.id} className="min-w-0">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="break-words">{profile.name}</CardTitle>
                    <CardDescription>{t("settings.printing.template", { name: profile.templateName })}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="m-0 text-[15px]">{t("settings.printing.copies", { count: profile.defaultCopies })}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Can do="spool.view_queue">
        <Button asChild variant="secondary" className="self-start">
          <UiLink to="/printing">{t("settings.printing.open")}</UiLink>
        </Button>
      </Can>
    </div>
  );
}
