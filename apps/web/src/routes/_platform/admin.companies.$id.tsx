import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import { UiLink } from "@orrn/ui/components/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { CompanyAccessTab } from "@/features/admin/company-access-tab";
import { CompanyPlanTab } from "@/features/admin/company-plan-tab";
import { CompanyPrintingTab } from "@/features/admin/company-printing-tab";
import { formatDay } from "@/features/admin/format";
import { companyStatusKey, companyStatusTone } from "@/features/admin/status";
import type { CompanyDetail } from "@/features/admin/types";
import { ConfirmDialog, errorCode, errorText, Fact, LoadError, Panel } from "@/features/admin/ui";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

const TABS = ["plan", "printing", "access"] as const;
type Tab = (typeof TABS)[number];

const TAB_KEYS: Record<Tab, MessageKey> = {
  plan: "admin.company.tabs.plan",
  printing: "admin.company.tabs.printing",
  access: "admin.company.tabs.access",
};

const PLAN_KEYS: Record<string, MessageKey> = {
  starter: "admin.plan.plans.starter",
  growth: "admin.plan.plans.growth",
  enterprise: "admin.plan.plans.enterprise",
};

export const Route = createFileRoute("/_platform/admin/companies/$id")({
  component: AdminCompany,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
});

/**
 * One company in Godseye (spec §3): facts, suspend or reactivate, and the
 * tabs Plan and modules, Printing (print stations, moved from /admin/spool)
 * and Access (support sessions). The tab lives in `?tab=` so a link can open
 * it (stopping a support session returns to `?tab=access`).
 */
function AdminCompany() {
  const { t } = useT();
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: me } = useMe();
  const detail = useQuery(trpc.platform.companiesGet.queryOptions({ id }));

  const tabs = TABS.filter((tab) => tab !== "printing" || can(me, "platform.spool.manage"));
  const tab: Tab = search.tab && tabs.includes(search.tab) ? search.tab : "plan";

  if (detail.isPending) return <DetailSkeleton />;
  if (detail.isError) {
    return errorCode(detail.error) === "NOT_FOUND" ? (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("admin.companies.title")} back={{ to: "/admin/companies", label: t("admin.company.back") }} />
        <Panel>
          <EmptyState
            title={t("admin.company.notFound")}
            action={
              <Button asChild variant="secondary">
                <UiLink to="/admin/companies">{t("admin.company.back")}</UiLink>
              </Button>
            }
          />
        </Panel>
      </div>
    ) : (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("admin.companies.title")} back={{ to: "/admin/companies", label: t("admin.company.back") }} />
        <LoadError message={t("admin.company.loadError")} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const company = detail.data.company;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        back={{ to: "/admin/companies", label: t("admin.company.back") }}
        title={company.name}
        actions={
          <Can do="platform.company.manage">
            <StatusAction company={company} />
          </Can>
        }
      />

      <Facts company={company} />

      <Tabs
        label={t("admin.company.sections")}
        items={tabs.map((item) => ({ id: item, label: t(TAB_KEYS[item]) }))}
        value={tab}
        onValueChange={(next) => void navigate({ search: { tab: next as Tab }, replace: true })}
      >
        {tab === "plan" ? <CompanyPlanTab company={company} /> : null}
        {tab === "printing" ? <CompanyPrintingTab company={company} /> : null}
        {tab === "access" ? <CompanyAccessTab detail={detail.data} /> : null}
      </Tabs>
    </div>
  );
}

function Facts({ company }: { company: CompanyDetail["company"] }) {
  const { t, locale } = useT();
  const planKey = company.plan ? PLAN_KEYS[company.plan] : undefined;
  return (
    <Panel aria-label={t("admin.company.facts")} className="px-5 py-4 sm:px-6">
      {/* Phone: the status gets its own row ("Waiting for approval" never has to be cut), the rest share one. */}
      <dl className="m-0 grid grid-cols-3 gap-x-4 gap-y-4 md:grid-cols-4">
        <Fact label={t("admin.company.status")} className="col-span-3 md:col-span-1">
          <Chip tone={companyStatusTone(company.status)} truncate={false}>{t(companyStatusKey(company.status))}</Chip>
        </Fact>
        <Fact label={t("admin.company.plan")}>
          {planKey ? t(planKey) : company.plan ? <span className="font-mono">{company.plan}</span> : t("admin.company.noPlan")}
        </Fact>
        <Fact label={t("admin.company.members")}>
          <span className="font-mono tabular-nums">{company.memberCount}</span>
        </Fact>
        <Fact label={t("admin.company.joined")}>{formatDay(company.createdAt, { locale })}</Fact>
      </dl>
      <p className="m-0 mt-4 border-t border-border pt-3 font-mono text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
        {company.slug}
      </p>
    </Panel>
  );
}

function StatusAction({ company }: { company: CompanyDetail["company"] }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const suspending = company.status === "active";

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: trpc.platform.companiesGet.queryKey({ id: company.id }) }),
      qc.invalidateQueries({ queryKey: trpc.platform.companiesList.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.platform.overview.queryKey() }),
    ]);

  const suspend = useMutation({
    ...trpc.platform.companiesSuspend.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.company.suspended"));
      setOpen(false);
      await refresh();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });
  const reactivate = useMutation({
    ...trpc.platform.companiesReactivate.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.company.reactivated"));
      setOpen(false);
      await refresh();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });
  const pending = suspend.isPending || reactivate.isPending;

  return (
    <>
      <Button variant="secondary" className={suspending ? "text-destructive" : undefined} onPress={() => setOpen(true)}>
        {suspending ? t("admin.company.suspend") : t("admin.company.reactivate")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={
          suspending
            ? t("admin.company.suspendTitle", { company: company.name })
            : t("admin.company.reactivateTitle", { company: company.name })
        }
        body={
          suspending
            ? t("admin.company.suspendBody", { company: company.name })
            : t("admin.company.reactivateBody", { company: company.name })
        }
        confirmLabel={suspending ? t("admin.company.suspend") : t("admin.company.reactivate")}
        tone={suspending ? "danger" : "primary"}
        pending={pending}
        onConfirm={() => (suspending ? suspend.mutate({ id: company.id }) : reactivate.mutate({ id: company.id }))}
      />
    </>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Skeleton className="h-11 w-32 rounded-full" />
      <Skeleton className="h-10 w-2/3 max-w-80" />
      <Skeleton className="h-[120px] rounded-card" />
      <Skeleton className="h-11 w-full max-w-96" />
      <Skeleton className="h-[260px] rounded-card" />
    </div>
  );
}
