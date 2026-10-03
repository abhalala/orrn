import { bundleTone, formatKg, gToKg, kgPer12ft } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Link, createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import { isCompanySlug } from "@/shared/lib/bundle-qr";
import { loadMe } from "@/shared/lib/guards";
import { useLengthUnit } from "@/shared/lib/length";
import { bundleDetailPath } from "@/shared/lib/paths";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpcClient } from "@/shared/utils/trpc";
import { TenantFrame } from "@/shell/tenant-frame";

type Candidate = { bundleId: string; number: string; year: number };

/**
 * `/b/$serial`: what a label QR and the "Scan or search" palette open. It sits
 * outside `_tenant` on purpose: a signed-out scan must not be forced to login
 * (plant spec P8, AGENTS.md).
 *
 * - Member of a company: the tenant summary inside the app shell. The code in
 *   the URL can be any printed format (plant number `26I4086`, old month-only
 *   `J540`, legacy FCMS id, `BG-` serial): `resolve.byCode` finds the bundle and
 *   a non-canonical code is replaced by the bundle's own number.
 * - Everyone else (signed out, or signed in without a company): the public
 *   view from `resolve.publicBundle` (company from `?c=`, else the host), only
 *   `{ number, section }`, and a button to sign in that returns here with `c`. Quantity and status stay behind a membership.
 *
 * The tenant page is a minimal summary; the Stock task builds the full screen.
 */
export const Route = createFileRoute("/b/$serial")({
  // `c` names the company on the label QR (`/b/26I4086?c=fourcubes`): production serves every
  // company from one host. A value that isn't a slug is ignored.
  validateSearch: (search: Record<string, unknown>): { c?: string } =>
    isCompanySlug(search.c) ? { c: search.c } : {},
  // Loads `me` without redirecting a signed-out visitor.
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context.queryClient);
    if (me) {
      const needsWelcome = me.user.mustChangePassword || (me.company && !me.impersonation && !me.user.onboardingCompleted);
      if (needsWelcome) throw redirect({ to: "/welcome" });
    }
    return { me };
  },
  // The router merges raw search keys back in, so check again here.
  loaderDeps: ({ search }) => ({ c: isCompanySlug(search.c) ? search.c : undefined }),
  loader: async ({ params, context, location, deps }) => {
    if (!context.me?.company) {
      try {
        // Plain client: a miss is this page's own message, not an error toast.
        const found = await trpcClient.resolve.publicBundle.query({
          code: params.serial,
          companyHost: deps.c ?? window.location.host,
        });
        return { audience: "public" as const, kind: "found" as const, number: found.number, section: found.section };
      } catch (error) {
        if (!isNotFound(error)) throw error;
        return { audience: "public" as const, kind: "notFound" as const };
      }
    }

    const hit = await trpcClient.resolve.byCode.query({ code: params.serial });
    if (hit.kind === "ambiguous") return { audience: "member" as const, kind: "ambiguous" as const, candidates: hit.candidates };
    if (hit.kind === "not_found") return { audience: "member" as const, kind: "notFound" as const };
    if (hit.number !== params.serial) {
      throw redirect({ href: `${bundleDetailPath({ serial: hit.number })}${location.searchStr}`, replace: true });
    }
    try {
      const detail = await trpcClient.bundle.getBySerial.query({ serial: hit.number });
      return { audience: "member" as const, kind: "bundle" as const, detail };
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return { audience: "member" as const, kind: "notFound" as const };
    }
  },
  component: BundlePage,
});

function BundlePage() {
  const data = Route.useLoaderData();
  if (data.audience === "public") return <PublicBundle data={data} />;
  return (
    <TenantFrame>
      {data.kind === "bundle" ? (
        <BundleSummary detail={data.detail} />
      ) : data.kind === "ambiguous" ? (
        <PickYear candidates={data.candidates} />
      ) : (
        <BundleNotFound />
      )}
    </TenantFrame>
  );
}

/** What a signed-out label scan sees: the number and section, nothing else. */
function PublicBundle({ data }: { data: { kind: "found"; number: string; section: string } | { kind: "notFound" } }) {
  const { t } = useT();
  const { me } = Route.useRouteContext();
  const { href } = useLocation();
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-8 px-4 py-10 text-foreground">
      <p className="m-0 font-display text-[22px] font-extrabold tracking-[-0.03em]">{t("common.appName")}</p>
      {data.kind === "found" ? (
        <div className="flex flex-col gap-2">
          <h1 className="m-0 break-words font-mono text-[34px] font-semibold leading-tight" data-testid="public-number">
            {data.number}
          </h1>
          <p className="m-0 text-[17px] text-muted-foreground" data-testid="public-section">
            {data.section}
          </p>
        </div>
      ) : (
        <h1 className="m-0 font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em]">
          {t("errors.notFound")}
        </h1>
      )}
      {me ? null : (
        <div>
          <Button asChild size="lg">
            <Link to="/login" search={{ next: href }}>
              {t("bundle.publicSignIn")}
            </Link>
          </Button>
        </div>
      )}
    </main>
  );
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
