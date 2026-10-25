import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

import { usePortalMe } from "./hooks";
import { bookDate, PortalError, PortalSkeleton } from "./ui";
import { certCasts, chemistryNote, kgText, pcsText, ppmPercentText, type CertCast, type CertSnapshot } from "./model";

const VERDICT_TONE = { pass: "green", fail: "red", incomplete: "amber" } as const;

/**
 * `/portal/certificate/$dispatchId`: the test certificate of a dispatch, a frozen snapshot. It cites
 * the casts behind the bundles with the chemistry of each, or says "chemistry pending" for a cast the
 * foundry has not tested. A quality document: no rate, not a tax invoice.
 */
export function PortalCertificatePage({ dispatchId }: { dispatchId: string }) {
  const { t, locale } = useT();
  usePortalMe();
  const q = useQuery({ ...trpc.portal.certificate.get.queryOptions({ dispatchId }), retry: false });
  const back = { to: `/portal/dispatches/${dispatchId}`, label: t("portal.dispatches.title") };

  if (q.isError) {
    return (
      <>
        <PageHeader title={t("portal.certificate.title")} back={back} />
        <PortalError error={q.error} onRetry={isNotFound(q.error) ? undefined : () => void q.refetch()} />
      </>
    );
  }
  if (!q.data) {
    return (
      <>
        <PageHeader title={t("portal.certificate.title")} back={back} />
        <PortalSkeleton />
      </>
    );
  }
  const snap = q.data.snapshot as unknown as CertSnapshot;
  const casts = certCasts(snap);
  const note = chemistryNote(snap.chemistry);
  const heading = snap.company.legalName || snap.company.name;

  return (
    <>
      <PageHeader
        title={t("portal.certificate.title")}
        back={back}
        subtitle={`${snap.number} · ${t("portal.certificate.revision", { n: q.data.revision })}`}
        actions={
          <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
            <Printer aria-hidden="true" strokeWidth={2} />
            {t("portal.dispatches.print")}
          </Button>
        }
      />

      <article aria-label={t("portal.certificate.title")} className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6" data-testid="portal-certificate">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 font-display text-[20px] leading-tight font-bold tracking-[-0.02em] break-words">{heading}</p>
          {[snap.company.address, snap.company.gstin ? `GSTIN ${snap.company.gstin}` : null, snap.company.phone].filter(Boolean).map((line) => (
            <p key={line} className="m-0 text-[13px] break-words text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
        <dl className="m-0 grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {[
            { k: t("portal.certificate.number"), v: snap.number, mono: true },
            { k: t("portal.certificate.issuedOn"), v: bookDate(snap.issuedOn, locale) },
            { k: t("portal.certificate.dispatch"), v: snap.dispatch.code, mono: true },
            { k: t("portal.dispatches.plNo"), v: snap.dispatch.plNumber ?? "-", mono: true },
          ].map((f) => (
            <div key={f.k} className="min-w-0">
              <dt className="text-[13px] text-muted-foreground">{f.k}</dt>
              <dd className={`m-0 text-[15px] font-semibold break-words ${f.mono ? "font-mono" : ""}`}>{f.v}</dd>
            </div>
          ))}
        </dl>
        <div className="min-w-0">
          <p className="m-0 text-[13px] text-muted-foreground">{t("portal.certificate.customer")}</p>
          <p className="m-0 text-[17px] font-semibold break-words">{snap.customer.name}</p>
        </div>

        <section aria-labelledby="cert-lines" className="flex min-w-0 flex-col gap-2">
          <h2 id="cert-lines" className="m-0 text-[17px] font-semibold">
            {t("portal.certificate.material")}
          </h2>
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0" data-testid="cert-lines">
            {snap.lines.map((l, i) => (
              <li key={i} className="flex min-w-0 flex-col gap-1 py-3 first:pt-0">
                <p className="m-0 text-[15px] font-semibold break-words">
                  {l.item}
                  <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground">{l.sectionCode}</span>
                </p>
                <p className="m-0 text-[14px] break-words text-muted-foreground">
                  {[[l.alloy, l.temper].filter(Boolean).join(" "), l.standard ? `${t("portal.certificate.standard")} ${l.standard}` : null, l.cml ? `${t("portal.certificate.licence")} ${l.cml}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {l.standardSource === "as_of_issue" ? <p className="m-0 text-[12px] text-muted-foreground">{t("portal.certificate.standardAsOfIssue")}</p> : null}
                {!l.profileKindSet ? <p className="m-0 text-[12px] text-muted-foreground">{t("portal.certificate.profileKindNotSet")}</p> : null}
                <p className="m-0 font-mono text-[14px] tabular-nums">
                  {pcsText(l.bundles)} {t("portal.dispatches.bundlesLabel")} · {pcsText(l.pcs)} {t("units.pcs")} · {kgText(l.weightG)} {t("units.kg")}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="cert-chem" className="flex min-w-0 flex-col gap-3">
          <h2 id="cert-chem" className="m-0 text-[17px] font-semibold">
            {t("portal.certificate.chemistry")}
          </h2>
          <p role="status" data-testid="cert-chemistry-note" className="m-0 text-[15px] font-medium">
            {t(note.key, note.vars)}
          </p>
          {casts.length > 0 ? (
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2" data-testid="cert-casts">
              {casts.map((c) => (
                <CastBlock key={c.castNo} cast={c} />
              ))}
            </ul>
          ) : null}
        </section>

        <p className="m-0 border-t border-border pt-3 text-[13px] text-muted-foreground">{t("portal.certificate.notTaxDocument")}</p>
      </article>
    </>
  );
}

function CastBlock({ cast }: { cast: CertCast }) {
  const { t } = useT();
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-3" data-cast={cast.castNo}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[15px] font-semibold">
          {t("portal.certificate.cast")} <span className="font-mono">{cast.castNo}</span>
          {cast.alloy ? <span className="ml-2 text-[13px] font-normal text-muted-foreground">{cast.alloy}</span> : null}
        </p>
        {cast.tested && cast.verdict ? (
          <Chip tone={VERDICT_TONE[cast.verdict]} truncate={false}>
            {t(`portal.certificate.verdict.${cast.verdict}`)}
          </Chip>
        ) : (
          <Chip tone="neutral" truncate={false}>
            {t("portal.certificate.castPending")}
          </Chip>
        )}
      </div>
      <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
        {pcsText(cast.bundles)} {t("portal.dispatches.bundlesLabel")} · {kgText(cast.weightG)} {t("units.kg")}
      </p>
      {cast.tested ? (
        <dl className="m-0 grid grid-cols-3 gap-x-3 gap-y-2" aria-label={t("portal.certificate.chemistry")}>
          {cast.elements.map((e) => (
            <div key={e.element} className="min-w-0">
              <dt className="text-xs font-medium uppercase text-muted-foreground">{e.element}</dt>
              <dd className="m-0 font-mono text-[14px] tabular-nums">
                {ppmPercentText(e.ppm)}
                {e.ppm != null ? <span className="text-xs text-muted-foreground"> %</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
