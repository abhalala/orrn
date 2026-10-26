import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { FormActions } from "@orrn/ui/components/form-actions";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { SectionDetail } from "@/features/die-room/section-detail";
import { DieForm } from "@/features/dies/die-form";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";

export const Route = createFileRoute("/_tenant/dies/$id")({
  component: DieRoute,
});

function DieRoute() {
  const { id } = Route.useParams();
  // Keyed by id: the router reuses this component when only $id changes, and one die's open sheet
  // or dialog must not carry over to the next.
  return id === "new" ? <NewDie /> : <SectionDetail key={id} id={id} />;
}

function NewDie() {
  const { t } = useT();
  const navigate = useNavigate();
  const { unit } = useLengthUnit();
  const formId = useId();
  const [pending, setPending] = useState(false);
  const back = { to: "/dies", label: t("nav.dies") };

  // Reachable by URL or a shared link even when the list hides "New die": a role that can't add
  // dies gets an explanation, not a form whose Save would be refused.
  return (
    <Can
      do="die.create"
      fallback={
        <>
          <PageHeader back={back} title={t("dies.form.titleNew")} />
          <EmptyState
            title={t("dies.form.cantAdd")}
            action={
              <Button asChild variant="secondary">
                <Link to="/dies">{t("dies.detail.backToList")}</Link>
              </Button>
            }
          />
        </>
      }
    >
      <PageHeader back={back} title={t("dies.form.titleNew")} actions={<HowToButton slug="edit-die" />} />
      <div className="flex w-full max-w-[720px] flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6">
        <DieForm
          formId={formId}
          unit={unit}
          onPendingChange={setPending}
          onSaved={(newId) => navigate({ to: "/dies/$id", params: { id: newId }, replace: true })}
        />
        <FormActions className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+12px)]">
          <Button variant="secondary" asChild>
            <Link to="/dies">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t("dies.form.submit")}
          </Button>
        </FormActions>
      </div>
    </Can>
  );
}
