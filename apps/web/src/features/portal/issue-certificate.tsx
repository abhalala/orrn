import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { staffErrorKey } from "./staff-model";

const CHEM_TONE = { pending: "amber", partial: "amber", ready: "green" } as const;

/**
 * Dispatch page (completed): issue the party's test certificate (`portal.certificates.issue`).
 * Issuing again makes the next revision under the same number. Chemistry the foundry has not tested
 * is shown as pending, never invented.
 */
export function IssueCertificate({ dispatchId }: { dispatchId: string }) {
  return (
    <Can do={["portal.manage", "dispatch.complete"]}>
      <IssueCertificateBox dispatchId={dispatchId} />
    </Can>
  );
}

function IssueCertificateBox({ dispatchId }: { dispatchId: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const current = useQuery({ ...trpc.portal.certificates.forDispatch.queryOptions({ dispatchId }), meta: INLINE_ERROR_META });
  const issue = useMutation(
    trpc.portal.certificates.issue.mutationOptions({
      onSuccess: (res) => {
        toast.success(t("portal.staff.certificateIssued", { number: res.number, revision: res.revision }));
        void queryClient.invalidateQueries({ queryKey: trpc.portal.certificates.forDispatch.queryKey({ dispatchId }) });
      },
      onError: (e) => toast.error(t(staffErrorKey(e))),
    }),
  );
  const cert = current.data;
  const chemistry = cert && (cert.chemistry === "pending" || cert.chemistry === "partial" || cert.chemistry === "ready") ? cert.chemistry : null;
  return (
    <>
      <section aria-label={t("portal.certificate.title")} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4" data-testid="issue-certificate">
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-semibold">{t("portal.certificate.title")}</p>
          <p className="m-0 flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground">
            {cert ? (
              <>
                <span className="font-mono">{cert.number}</span>
                <span>{t("portal.certificate.revision", { n: cert.revision })}</span>
                {chemistry ? (
                  <Chip tone={CHEM_TONE[chemistry]} truncate={false}>
                    {t(`portal.staff.chemistry_${chemistry}`)}
                  </Chip>
                ) : null}
              </>
            ) : (
              t("portal.staff.noCertificate")
            )}
          </p>
        </div>
        <Button variant={cert ? "secondary" : "primary"} loading={issue.isPending} onClick={() => issue.mutate({ dispatchId })} data-testid="issue-certificate-button">
          <ScrollText aria-hidden="true" strokeWidth={2} />
          {cert ? t("portal.staff.reissueCertificate") : t("portal.staff.issueCertificate")}
        </Button>
      </section>
    </>
  );
}
