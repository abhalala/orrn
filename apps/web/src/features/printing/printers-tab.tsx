import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { trpc } from "@/shared/utils/trpc";

import { nodeTone, scaleRowOf } from "./model";

/**
 * Print computers (`edge.overview`) and the label printers set up for the
 * plant (`spool.listProfiles`). A node shows its stored status and the time
 * of its last heartbeat, nothing more: paper, ribbon and power are not
 * reported, and the page says so.
 */
export function PrintersTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const nodes = useQuery(trpc.edge.overview.queryOptions());
  const profiles = useQuery(trpc.spool.listProfiles.queryOptions());

  if (nodes.isPending || profiles.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
      </div>
    );
  }

  if (nodes.isError || profiles.isError) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("printing.loadFailed")}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void nodes.refetch();
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

  const nodeRows = nodes.data.nodes;
  const profileRows = profiles.data;

  if (nodeRows.length === 0 && profileRows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState title={t("printing.notSetUpTitle")} body={t("printing.notSetUpBody")} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("printing.nodes.hint")}</p>

      <section aria-labelledby="print-nodes" className="flex min-w-0 flex-col gap-3">
        <h2 id="print-nodes" className="m-0 text-[17px] font-semibold">
          {t("printing.nodes.title")}
        </h2>
        {nodeRows.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("printing.printers.empty")} />
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
            {nodeRows.map((node) => (
              <li key={node.id} className="min-w-0" data-testid="print-node">
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <CardTitle className="min-w-0 break-words">{node.nodeName}</CardTitle>
                      <Chip tone={nodeTone(node.status)}>{t(`status.printSetup.${node.status}`)}</Chip>
                    </div>
                    <CardDescription>{t("printing.nodes.site", { site: node.siteLabel })}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="m-0 text-[15px]">
                      {node.lastHeartbeatAt
                        ? t("printing.printers.lastSeen", { time: when(node.lastHeartbeatAt) })
                        : t("printing.nodes.neverSeen")}
                    </p>
                    {node.runtimeVersion ? (
                      <p className="m-0 text-[13px] text-muted-foreground">
                        {t("printing.nodes.version", { version: node.runtimeVersion })}
                      </p>
                    ) : null}
                    <ScaleRow node={node} when={when} />
                    {node.lastErrorMessage ? (
                      <p className="m-0 text-[13px] break-words text-muted-foreground">
                        {t("printing.nodes.lastError", { message: node.lastErrorMessage })}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="print-profiles" className="flex min-w-0 flex-col gap-3">
        <h2 id="print-profiles" className="m-0 text-[17px] font-semibold">
          {t("printing.nodes.profiles")}
        </h2>
        {profileRows.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("printing.nodes.profilesEmpty")} />
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
            {profileRows.map((profile) => (
              <li key={profile.id} className="min-w-0" data-testid="print-profile">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="break-words">{profile.name}</CardTitle>
                    <CardDescription>{t("printing.nodes.template", { name: profile.templateName })}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="m-0 text-[15px]">{t("printing.nodes.copies", { count: profile.defaultCopies })}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The scale beside the printer (FP-PK-02): configured, simulated, connected, and when its last frame came. */
function ScaleRow({
  node,
  when,
}: {
  node: Parameters<typeof scaleRowOf>[0];
  when: (d: Date | string | number) => string;
}) {
  const { t } = useT();
  const row = scaleRowOf(node);
  return (
    <div data-slot="scale-row" data-scale={row.kind} className="mt-2 flex min-w-0 flex-col gap-1 border-t border-border pt-2">
      <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
        {t("printing.scale.title")}
        {row.kind === "connected" ? <Chip tone="green">{t("printing.scale.connected")}</Chip> : null}
        {row.kind === "idle" ? <Chip tone="amber">{t("printing.scale.idle")}</Chip> : null}
        {row.kind === "none" ? <Chip tone="neutral">{t("printing.scale.none")}</Chip> : null}
        {row.kind === "unknown" ? <Chip tone="neutral">{t("printing.scale.unknown")}</Chip> : null}
        {row.kind === "connected" || row.kind === "idle" ? (
          <>
            <Chip tone="neutral">{t("printing.scale.configured")}</Chip>
            {row.simulated ? <Chip tone="blue">{t("printing.scale.simulated")}</Chip> : null}
          </>
        ) : null}
      </p>
      <p className="m-0 text-[13px] text-muted-foreground">
        {row.kind === "connected"
          ? t("printing.scale.lastFrame", { time: when(row.lastFrameAt) })
          : row.kind === "idle"
            ? t("printing.scale.noFrame", { time: when(row.reportedAt) })
            : row.kind === "none"
              ? t("printing.scale.noneHint")
              : t("printing.scale.unknownHint")}
      </p>
    </div>
  );
}
