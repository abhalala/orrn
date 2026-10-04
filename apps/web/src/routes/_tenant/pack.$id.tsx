import { bundleTone, formatKg, formatKgTotal, formatLength, gToKg, type BundleStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BigNumber } from "@orrn/ui/components/big-number";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { useMemo } from "react";

import { packedWhen } from "@/features/pack/format";
import { bundleRange, formatK12, lengthUnitOf, RangeChip, timezoneOf } from "@/features/pack/pack-ui";
import { PrintPanel } from "@/features/pack/print-panel";
import { useCanPrintLabels, usePrintQueue } from "@/features/pack/use-print-labels";
import { useLocationCodes } from "@/features/pack/use-yards";
import { Can } from "@/shared/components/can";
import { isNotFound } from "@/shared/lib/session-errors";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/pack/$id")({
  component: PackSession,
});

type SessionBundle = {
  id: string;
  serial: string;
  status: BundleStatus;
  quantity: number;
  weightG: number;
  lengthMm: number;
  poNumber: string | null;
  locationId: string | null;
};

const STATUS_ORDER: BundleStatus[] = ["available", "reserved", "dispatched", "void"];

const bySerial = new Intl.Collator("en", { numeric: true });

function PackSession() {
  const { t, locale } = useT();
  const { id } = Route.useParams();
  const { data: me } = useMe();
  const unit = lengthUnitOf(me?.company?.settings);
  const timeZone = timezoneOf(me?.company?.settings);
  const session = useQuery(trpc.bundle.getGroup.queryOptions({ id }));
  const { canPrint } = useCanPrintLabels();
  const queue = usePrintQueue(id);
  const locationCodes = useLocationCodes();

  const data = session.data;
  // Serials in counting order (26J9 before 26J10; the server sorts them as text).
  const bundles = useMemo(
    () => [...((data?.bundles ?? []) as SessionBundle[])].sort((a, b) => bySerial.compare(a.serial, b.serial)),
    [data?.bundles],
  );
  const die = data?.die ?? null;

  const printable = useMemo(
    () => bundles.filter((b) => b.status !== "void").map((b) => ({ bundleId: b.id, serial: b.serial })),
    [bundles],
  );

  const columns = useMemo((): ResponsiveListColumn<SessionBundle>[] => {
    const cols: ResponsiveListColumn<SessionBundle>[] = [
      {
        key: "serial",
        header: t("stock.columns.serial"),
        cell: (b) => <span className="font-mono font-semibold whitespace-nowrap">{b.serial}</span>,
      },
      {
        key: "status",
        header: t("stock.columns.status"),
        cell: (b) => <Chip tone={bundleTone(b.status)}>{t(`status.bundle.${b.status}`)}</Chip>,
      },
      {
        key: "weight",
        header: t("stock.columns.weight"),
        align: "end",
        cell: (b) => <span className="font-mono tabular-nums">{formatKg(gToKg(b.weightG))}</span>,
      },
      {
        key: "pieces",
        header: t("stock.columns.pieces"),
        align: "end",
        cell: (b) => <span className="font-mono tabular-nums">{b.quantity}</span>,
      },
      {
        key: "length",
        header: t("stock.columns.cutLength"),
        cell: (b) => <span className="font-mono whitespace-nowrap">{formatLength(b.lengthMm, unit)}</span>,
      },
      {
        key: "k12",
        header: t("stock.columns.kgPer12ft"),
        align: "end",
        cell: (b) => {
          const { k } = bundleRange({ weightG: b.weightG, pieces: b.quantity, lengthMm: b.lengthMm }, die);
          return <span className="font-mono tabular-nums">{k !== null ? formatK12(k) : ""}</span>;
        },
      },
      {
        // Shown on phones too: an amber bundle is what a floor check looks for.
        key: "range",
        header: t("pack.detail.rangeColumn"),
        cell: (b) => {
          const { verdict } = bundleRange({ weightG: b.weightG, pieces: b.quantity, lengthMm: b.lengthMm }, die);
          return <RangeChip verdict={verdict} />;
        },
      },
    ];
    if (bundles.some((b) => b.poNumber)) {
      cols.push({
        key: "po",
        header: t("stock.columns.po"),
        hideOnPhone: true,
        cell: (b) => <span className="font-mono break-all">{b.poNumber ?? ""}</span>,
      });
    }
    if (canPrint) {
      cols.push({
        key: "reprint",
        header: t("pack.print.title"),
        cell: (b) =>
          b.status === "void" ? null : (
            <Can do="spool.create_jobs">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void queue.run([{ bundleId: b.id, serial: b.serial }])}
                aria-label={t("pack.detail.reprintSerial", { serial: b.serial })}
              >
                <Printer strokeWidth={2} aria-hidden="true" />
                {t("pack.detail.reprint")}
              </Button>
            </Can>
          ),
      });
    }
    return cols;
  }, [t, unit, die, bundles, canPrint, queue.run]);

  // Only when there is nothing to show: a failed background refresh keeps the session on screen.
  if (session.isError && !data) {
    const notFound = isNotFound(session.error);
    return (
      <>
        <PageHeader title={t("pack.title")} back={{ to: "/pack", label: t("pack.title") }} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={notFound ? t("pack.detail.notFound") : t("pack.detail.loadFailed")}
            action={
              notFound ? (
                <Button asChild variant="secondary">
                  <UiLink to="/pack">{t("pack.title")}</UiLink>
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => void session.refetch()}>
                  {t("common.retry")}
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }

  if (!data) return <SessionSkeleton />;

  const group = data.group;
  const totalWeightG = bundles.reduce((s, b) => s + b.weightG, 0);
  const totalPieces = bundles.reduce((s, b) => s + b.quantity, 0);
  const lengths = new Set(bundles.map((b) => b.lengthMm));
  // Where the bundles are now (packed into one yard; a later move can split them).
  const yards = new Set(bundles.flatMap((b) => (b.locationId ? [b.locationId] : [])));
  const when = packedWhen(group.createdAt, { timeZone, locale });
  const whenText =
    when.day === "today"
      ? t("pack.whenToday", { time: when.time })
      : when.day === "yesterday"
        ? t("pack.whenYesterday", { time: when.time })
        : t("pack.whenDate", { date: when.date, time: when.time });
  const counts = STATUS_ORDER.map((s) => ({ s, n: bundles.filter((b) => b.status === s).length })).filter(
    (c) => c.n > 0,
  );

  return (
    <>
      <PageHeader
        title={t("pack.detail.title", { code: group.code })}
        subtitle={die ? [die.sectionCode, die.series, die.name].filter(Boolean).join(", ") : undefined}
        back={{ to: "/pack", label: t("pack.title") }}
        actions={
          <>
            <HowToButton slug="reprint-label" />
            {canPrint && printable.length > 0 ? (
              <Can do="spool.create_jobs">
                <Button onClick={() => void queue.run(printable)} disabled={queue.status === "running"}>
                  <Printer strokeWidth={2} aria-hidden="true" />
                  {t("pack.detail.printAll")}
                </Button>
              </Can>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div
          data-slot="session-totals"
          className="orrn-block orrn-block-neutral orrn-block-sheen flex flex-col gap-4 p-5 sm:p-6"
        >
          <div className="relative flex flex-wrap items-end gap-x-6 gap-y-3 sm:gap-x-8">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[13px] font-semibold">{t("pack.columns.bundles")}</span>
              <BigNumber value={bundles.length} className="text-[44px] sm:text-[52px]" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[13px] font-semibold">{t("pack.new.totalPieces")}</span>
              <BigNumber value={totalPieces} className="text-[44px] sm:text-[52px]" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[13px] font-semibold">{t("units.kg")}</span>
              <BigNumber value={gToKg(totalWeightG)} format={formatKgTotal} className="text-[44px] sm:text-[52px]" />
            </div>
          </div>
          {counts.length > 0 ? (
            <ul className="relative m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t("stock.columns.status")}>
              {counts.map(({ s, n }) => (
                <li key={s}>
                  <Chip tone={bundleTone(s)}>
                    {n} {t(`status.bundle.${s}`)}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <dl
          aria-label={t("pack.detail.facts")}
          className="m-0 grid grid-cols-2 content-start gap-x-5 gap-y-4 rounded-card border border-border bg-card p-4 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 sm:p-5"
        >
          <Fact label={t("pack.new.cutLength")}>
            <span className="font-mono font-semibold whitespace-nowrap" data-testid="session-cut-length">
              {lengths.size === 1
                ? formatLength([...lengths][0]!, unit)
                : lengths.size > 1
                  ? t("pack.detail.mixed")
                  : ""}
            </span>
          </Fact>
          {yards.size > 0 ? (
            <Fact label={t("pack.new.yard")}>
              <span className="font-mono font-semibold" data-testid="session-yard">
                {yards.size === 1 ? (locationCodes.get([...yards][0]!) ?? "") : t("pack.detail.mixed")}
              </span>
            </Fact>
          ) : null}
          <Fact label={t("pack.new.po")}>
            {group.purchaseOrderRef ? (
              <span className="font-mono font-semibold break-all">{group.purchaseOrderRef}</span>
            ) : (
              <span className="text-muted-foreground">{t("pack.new.noPo")}</span>
            )}
          </Fact>
          <Fact label={t("pack.columns.packedBy")}>{data.packedByName ?? t("pack.unknownPacker")}</Fact>
          <Fact label={t("pack.detail.unit")}>
            {group.unit === "inch"
              ? t("pack.detail.unitInch")
              : group.unit === "mm"
                ? t("pack.detail.unitMm")
                : group.unit}
          </Fact>
          <Fact label={t("pack.detail.packedAt")}>
            <span className="tabular-nums">{whenText}</span>
          </Fact>
        </dl>
      </div>

      <PrintPanel state={queue} onRetry={() => void queue.retryFailed()} />

      <section aria-labelledby="pack-session-bundles" className="flex flex-col gap-2">
        <h2 id="pack-session-bundles" className="m-0 text-[17px] font-semibold">
          {t("pack.detail.bundlesTitle")}
        </h2>
        <ResponsiveList
          rows={bundles}
          columns={columns}
          rowKey={(b) => b.id}
          rowHref={(b) => `/b/${encodeURIComponent(b.serial)}`}
          label={t("pack.detail.bundlesTitle")}
          empty={<EmptyState title={t("pack.new.noBundlesYet")} />}
        />
      </section>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-[15px] break-words">{children}</dd>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Skeleton className="h-[168px] rounded-block" />
        <Skeleton className="h-[168px] rounded-card" />
      </div>
      <Skeleton className="h-[320px] rounded-card" />
    </div>
  );
}
