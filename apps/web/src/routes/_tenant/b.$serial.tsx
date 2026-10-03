import { bundleTone, formatKg, gToKg, kgPer12ft } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";

import { useLengthUnit } from "@/shared/lib/length";
import { bundleDetailPath } from "@/shared/lib/paths";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpcClient } from "@/shared/utils/trpc";

type Candidate = { bundleId: string; number: string; year: number };

/**
 * `/b/$serial`: what a label QR and the "Scan or search" palette open. The
 * code in the URL can be any printed format (plant number `26I4086`, old
 * month-only `J540`, legacy FCMS id, `BG-` serial): `resolve.byCode` finds the
 * bundle and a non-canonical code is replaced by the bundle's own number, so
 * the address bar always shows the number on the label.
 *
 * The page is a minimal summary; the Stock task builds the full bundle screen.
 */
export const Route = createFileRoute("/_tenant/b/$serial")({
  loader: async ({ params }) => {
    // Plain client: a miss is this page's own message, not an error toast.
    const hit = await trpcClient.resolve.byCode.query({ code: params.serial });
    if (hit.kind === "ambiguous") return { kind: "ambiguous" as const, candidates: hit.candidates };
    if (hit.kind === "not_found") return { kind: "notFound" as const };
    if (hit.number !== params.serial) {
      throw redirect({ href: bundleDetailPath({ serial: hit.number }), replace: true });
    }
    try {
      const detail = await trpcClient.bundle.getBySerial.query({ serial: hit.number });
      return { kind: "bundle" as const, detail };
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return { kind: "notFound" as const };
    }
  },
  component: BundlePage,
});

function BundlePage() {
  const data = Route.useLoaderData();
  if (data.kind === "bundle") return <BundleSummary detail={data.detail} />;
  if (data.kind === "ambiguous") return <PickYear candidates={data.candidates} />;
  return <BundleNotFound />;
}

type Detail = Awaited<ReturnType<typeof trpcClient.bundle.getBySerial.query>>;

function BundleSummary({ detail }: { detail: Detail }) {
  const { t } = useT();
  const lu = useLengthUnit();
  const { bundle, die } = detail;
  const perFoot = kgPer12ft({ weightG: bundle.weightG, pieces: bundle.quantity, lengthMm: bundle.lengthMm });

  const facts: { label: string; value: string }[] = [
    { label: t("bundle.facts.weight"), value: `${formatKg(gToKg(bundle.weightG))} kg` },
    { label: t("bundle.facts.pieces"), value: String(bundle.quantity) },
    { label: t("bundle.facts.cutLength"), value: lu.formatLength(bundle.lengthMm) },
    { label: t("bundle.facts.kgPer12ft"), value: perFoot === null ? "-" : formatKg(perFoot) },
    { label: t("bundle.facts.section"), value: die ? `${die.series} ${die.sectionCode}` : "-" },
    ...(bundle.poNumber ? [{ label: t("bundle.facts.po"), value: bundle.poNumber }] : []),
  ];

  return (
    <>
      <PageHeader
        title={t("bundle.title", { serial: bundle.serial })}
        back={{ to: "/stock/bundles", label: t("stock.list.title") }}
      />
      <div>
        <Chip tone={bundleTone(bundle.status)}>{t(`status.bundle.${bundle.status}`)}</Chip>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-4 rounded-card border border-border bg-card p-4 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[13px] font-medium text-muted-foreground">{f.label}</dt>
            <dd className="m-0 truncate font-mono text-[17px] font-semibold" title={f.value}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** An old month-only number (`J540`) that matches bundles from more than one year. */
function PickYear({ candidates }: { candidates: Candidate[] }) {
  const { t } = useT();
  const { serial } = Route.useParams();
  return (
    <>
      <PageHeader title={t("bundle.ambiguousTitle")} subtitle={t("bundle.ambiguousBody", { code: serial })} />
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-card border border-border bg-card p-0">
        {candidates.map((c) => (
          <li key={c.bundleId} className="border-b border-border last:border-b-0">
            <Link
              to="/b/$serial"
              params={{ serial: c.number }}
              className="flex min-h-14 min-w-0 items-center justify-between gap-3 px-4 py-3 no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent"
            >
              <span className="min-w-0 truncate font-mono text-[17px] font-semibold">{c.number}</span>
              <span className="shrink-0 text-[15px] text-muted-foreground">{c.year}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function BundleNotFound() {
  const { t } = useT();
  const { serial } = Route.useParams();
  return (
    <EmptyState
      title={t("errors.notFoundInCompany")}
      body={serial}
      action={
        <Button asChild variant="secondary">
          <Link to="/today">{t("errors.goToday")}</Link>
        </Button>
      }
    />
  );
}
