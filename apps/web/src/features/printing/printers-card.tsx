import { useT } from "@orrn/i18n";
import type { LabelDocument } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Lock, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import { Can } from "@/shared/components/can";

import { LabelPreview } from "./label-artwork";
import type { LabelValues } from "./label-metrics";
import { PrinterActions } from "./printers-actions";
import { printerTone, type PrinterReport } from "./printers-model";

type When = (d: Date | string | number) => string;

export type PrinterProfile = {
  id: string;
  name: string;
  spoolPrinterId: string;
  templateId: string;
  templateName: string;
  defaultCopies: number;
  macAddress: string | null;
  verifiedHost: string | null;
  verifiedPort: number | null;
  capabilitiesVerifiedAt: Date | string | null;
};

/** The design a printer prints: its published document, still loading, or not readable. */
export type PrinterDesign = { kind: "ready"; document: LabelDocument; version: number } | { kind: "loading" } | { kind: "missing" };

/**
 * One label printer: its status word and colour from the print computer's last report, where it prints to (and the
 * hardware address it is locked to once verified), copies per label, and the label it prints drawn with a real
 * bundle's values. Admin actions sit in one menu; designers get a link to the studio.
 */
export function PrinterCard({
  profile,
  report,
  design,
  sample,
  when,
  onOpenSettings,
}: {
  profile: PrinterProfile;
  report: PrinterReport | null;
  design: PrinterDesign;
  sample: { values: LabelValues; serial: string | undefined };
  when: When;
  onOpenSettings(): void;
}) {
  const { t } = useT();
  const state = report?.state ?? "unknown";
  const host = report?.host ?? profile.verifiedHost;
  const port = report?.port ?? profile.verifiedPort;
  const mac = profile.macAddress ?? report?.macAddress ?? null;
  const headingId = `printer-${profile.id}`;

  return (
    <li className="min-w-0" data-testid="print-profile" data-state={state}>
      <article
        aria-labelledby={headingId}
        className="grid min-w-0 grid-cols-1 overflow-hidden rounded-card border border-border bg-card shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
      >
        <div className="@container flex min-w-0 flex-col gap-4 p-5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h3 id={headingId} className="m-0 text-[17px] leading-snug font-semibold break-words">
                {profile.name}
              </h3>
              <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                <Chip tone={printerTone(state)}>{t(`printing.printers.state.${state}`)}</Chip>
                <span className="break-words">
                  {report?.lastSeenAt ? t("printing.printers.lastSeen", { time: when(report.lastSeenAt) }) : t("printing.printers.notReported")}
                </span>
              </p>
            </div>
            <Can do="spool.manage_printers">
              <PrinterActions profile={profile} onOpenSettings={onOpenSettings} />
            </Can>
          </div>

          <dl className="m-0 grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 @sm:grid-cols-2">
            <Fact term={t("printing.printers.model")}>{report?.model ?? <Muted>{t("printing.printers.notReported")}</Muted>}</Fact>
            <Fact term={t("printing.printers.address")}>
              {host ? <span className="font-mono tabular-nums">{port ? `${host}:${port}` : host}</span> : <Muted>{t("printing.printers.notReported")}</Muted>}
            </Fact>
            <Fact term={t("printing.printers.copies")}>{t("printing.printers.copiesValue", { count: profile.defaultCopies })}</Fact>
            <Fact term={t("printing.printers.locked")}>
              {mac ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Lock aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
                  <span className="font-mono tabular-nums break-all">{mac}</span>
                </span>
              ) : (
                <Muted>{t("printing.printers.notLocked")}</Muted>
              )}
            </Fact>
          </dl>
          {mac && profile.capabilitiesVerifiedAt ? (
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">
              {t("printing.printers.lockedHint", { time: when(profile.capabilitiesVerifiedAt) })}
            </p>
          ) : null}
          {report?.lastError ? (
            <p className="m-0 text-[13px] leading-5 font-medium break-words text-destructive">
              {t("printing.printers.lastProblem", { message: report.lastError })}
            </p>
          ) : null}
        </div>

        <figure className="m-0 flex min-w-0 flex-col gap-3 border-t border-border bg-surface-sunken p-5 lg:border-t-0 lg:border-l">
          <figcaption className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] text-muted-foreground">{t("printing.printers.prints")}</span>
            <span className="text-[15px] font-semibold break-words">
              {profile.templateName}
              {design.kind === "ready" ? (
                <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground tabular-nums">
                  {t("printing.printers.designVersion", { version: design.version })}
                </span>
              ) : null}
            </span>
          </figcaption>
          {design.kind === "ready" ? (
            <LabelPreview
              document={design.document}
              values={sample.values}
              title={
                sample.serial
                  ? t("printing.printers.previewTitle", { name: profile.templateName, serial: sample.serial })
                  : t("printing.printers.previewExample", { name: profile.templateName })
              }
              className="max-w-[22rem]"
            />
          ) : design.kind === "loading" ? (
            <Skeleton className="aspect-[4/3] w-full max-w-[22rem] rounded-[3px]" />
          ) : (
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("printing.printers.designMissing")}</p>
          )}
          {design.kind === "ready" ? (
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">
              {design.document.elements.length === 0
                ? t("printing.printers.designEmpty")
                : sample.serial
                  ? t("printing.printers.sampleBundle", { serial: sample.serial })
                  : t("printing.printers.sampleExample")}
            </p>
          ) : null}
          <Can do="spool.push_templates">
            <Button asChild variant="secondary" className="self-start">
              <UiLink to={`/printing/templates/${profile.templateId}`} aria-label={t("printing.printers.editDesignFor", { name: profile.templateName })}>
                <Pencil aria-hidden="true" strokeWidth={2} />
                {t("printing.printers.editDesign")}
              </UiLink>
            </Button>
          </Can>
        </figure>
      </article>
    </li>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="m-0 text-[15px] font-medium break-words">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="font-normal text-muted-foreground">{children}</span>;
}
