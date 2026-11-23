import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";

import { LineView } from "./line-view";
import { PendingView } from "./pending-view";
import { RegisterView } from "./register-view";
import { VendorsView } from "./vendors-view";

type Tab = "pending" | "register" | "line" | "vendors";

/**
 * `/jobwork`: what is out at vendors now, the register of every step, the in-house finishing line and, for people who keep
 * the masters, the vendors. One primary action, New challan, for people who may send; the line has its own Start.
 */
export function JobworkScreen() {
  const { t } = useT();
  const { data: me } = useMe();
  const [tab, setTab] = useState<Tab>("pending");
  const masters = can(me, "jobwork.masters");
  const items = [
    { id: "pending", label: t("jw.tabs.pending") },
    { id: "register", label: t("jw.tabs.register") },
    { id: "line", label: t("jw.tabs.line") },
    ...(masters ? [{ id: "vendors", label: t("jw.tabs.vendors") }] : []),
  ];
  const active: Tab = tab === "vendors" && !masters ? "pending" : tab;
  return (
    <>
      <PageHeader
        title={t("jw.title")}
        subtitle={t("jw.subtitle")}
        actions={
          <>
            <Can do="jobwork.send">
              <Button asChild>
                <UiLink to="/jobwork/new" className="no-underline" data-testid="new-challan">
                  <Plus aria-hidden="true" className="size-4" />
                  {t("jw.action.newChallan")}
                </UiLink>
              </Button>
            </Can>
          </>
        }
      />
      <Tabs items={items} value={active} onValueChange={(v) => setTab(v as Tab)} label={t("jw.tabs.label")}>
        {active === "pending" ? <PendingView /> : null}
        {active === "register" ? <RegisterView /> : null}
        {active === "line" ? <LineView /> : null}
        {active === "vendors" ? <VendorsView /> : null}
      </Tabs>
    </>
  );
}
