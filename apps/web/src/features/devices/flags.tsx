import { useT } from "@orrn/i18n";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/shared/utils/trpc";

import { DEVICE_VIEWERS, LAB_PEOPLE, useDevicesFlagOn, type DeviceCounts, type LabForSubject } from "./hooks";
import { tileTone } from "./model";
import { ResultChip } from "./result-chip";

/** Today: how many plant devices are live, late or silent. Nothing without the module or `device.view`. */
export function TodayDevicesTile() {
  const on = useDevicesFlagOn(DEVICE_VIEWERS);
  const q = useQuery({ ...trpc.devices.health.queryOptions(), enabled: on, retry: false });
  if (!on || !q.data || q.data.total === 0) return null;
  return <TodayDevicesTileBody data={q.data} />;
}

export function TodayDevicesTileBody({ data }: { data: DeviceCounts }) {
  const { t } = useT();
  const meta = t("dev3.today.meta", { live: data.live, late: data.late, silent: data.silent });
  return (
    <section aria-labelledby="today-devices" data-testid="today-devices" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-devices" className="m-0 text-[17px] font-semibold">
          {t("dev3.today.title")}
        </h2>
        <UiLink to="/devices" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
          {t("dev3.today.open")}
        </UiLink>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusBlock
          tone={tileTone(data)}
          title={t("dev3.devices.strip.total")}
          meta={data.simulated > 0 ? `${meta}. ${t("dev3.today.simulated", { count: data.simulated })}` : meta}
          value={data.total}
          countUp={false}
          href="/devices"
        />
      </div>
    </section>
  );
}

/** A press run or a die copy: results from the scanner and tensile tester, and how many are out of tolerance. */
export function LabResultsCard({ pressRunId, dieInstanceId }: { pressRunId?: string; dieInstanceId?: string }) {
  const on = useDevicesFlagOn(LAB_PEOPLE);
  const q = useQuery({
    ...trpc.devices.lab.forSubject.queryOptions(pressRunId ? { pressRunId } : { dieInstanceId: dieInstanceId ?? "" }),
    enabled: on && Boolean(pressRunId || dieInstanceId),
    retry: false,
  });
  if (!on || !q.data) return null;
  return <LabResultsCardBody data={q.data} />;
}

export function LabResultsCardBody({ data }: { data: LabForSubject }) {
  const { t } = useT();
  return (
    <Card size="sm" data-testid="dev3-lab-card" className="min-w-0">
      <CardTitle as="h3">{t("dev3.labCard.title")}</CardTitle>
      {data.items.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("dev3.labCard.empty")}</p>
      ) : (
        <>
          <p data-testid="dev3-lab-count" className={data.outOfTolerance > 0 ? "m-0 text-[14px] font-semibold text-tone-red-ink" : "m-0 text-[14px] text-muted-foreground"}>
            {data.outOfTolerance > 0 ? t("dev3.labCard.outOfTolerance", { count: data.outOfTolerance }) : t("dev3.labCard.allIn")}
          </p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {data.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-[14px]">
                <ResultChip result={i.result} />
                <span className="font-mono">{i.number}</span>
                {i.deviceCode ? <span className="text-muted-foreground">{t("dev3.labCard.deviceBy", { code: i.deviceCode })}</span> : null}
                {i.flagged.length > 0 ? <span className="text-tone-red-ink">{t("dev3.labCard.flagged", { names: i.flagged.join(", ") })}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
