import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";

import { ApprovalRulesPanel } from "./adm-approvals";
import { NumberFormatsPanel } from "./adm-formats";
import { InsurancePanel } from "./adm-insurance";
import { RULES_TABS, type RulesTab } from "./adm-search";
import { useAdmAccess } from "./adm-use";
import { MastersNoAccess } from "./masters-ui";

/**
 * Plant rules (route /masters/rules?tab=): how document numbers read, who approves each kind of
 * request, and the transit insurance printed on packing lists. Publishers read all three; admins and
 * the owner change the number formats and approvers.
 */
export function PlantRulesPage({ tab, onTab }: { tab: RulesTab; onTab(tab: RulesTab): void }) {
  const { t } = useT();
  const access = useAdmAccess();
  const back = { to: "/masters", label: t("masters.backToMasters") } as const;
  if (access.me !== undefined && !access.canPublish) {
    return (
      <>
        <PageHeader back={back} title={t("adm.masters.rules.title")} />
        <MastersNoAccess />
      </>
    );
  }
  return (
    <>
      <PageHeader back={back} title={t("adm.masters.rules.title")} subtitle={t("adm.masters.rules.subtitle")} />
      <Tabs
        label={t("adm.masters.rules.tabsLabel")}
        value={tab}
        onValueChange={(v) => onTab(v as RulesTab)}
        items={RULES_TABS.map((k) => ({ id: k, label: t(`adm.masters.rules.tabs.${k}`) }))}
      >
        {tab === "formats" ? <NumberFormatsPanel /> : tab === "approvals" ? <ApprovalRulesPanel /> : <InsurancePanel />}
      </Tabs>
    </>
  );
}
