import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { Link } from "@tanstack/react-router";

import { Can } from "@/shared/components/can";
import { StoreNote } from "@/features/store/store-ui";

import { IndentsTab } from "./indents-tab";
import { OrdersTab } from "./orders-tab";
import { BUY_TABS, type BuyTab } from "./search";
import { useBuyAccess } from "./use-buy";
import { ValueTab } from "./value-tab";

/**
 * Buying (`/store/buy`, XE store rows 69, 70, 73): indents, purchase orders and the store's value, one
 * tab each. A tab shows only to people who may read it; with none, a quiet note.
 */
export function BuyPage({ tab, onTab }: { tab: BuyTab; onTab: (tab: BuyTab) => void }) {
  const { t } = useT();
  const access = useBuyAccess();
  const visible = BUY_TABS.filter((id) => (id === "indents" ? access.readIndents : id === "orders" ? access.readOrders : access.value));
  const current = visible.includes(tab) ? tab : (visible[0] ?? "indents");

  const header = (
    <PageHeader
      title={t("store2.buy.title")}
      subtitle={t("store2.buy.subtitle")}
      actions={
        <Can do={["store.txn", "masters.publish"]}>
          <Button asChild variant="secondary">
            <Link to="/store">{t("store2.buy.openStore")}</Link>
          </Button>
        </Can>
      }
    />
  );

  if (visible.length === 0) {
    return (
      <>
        {header}
        <StoreNote body={t("store2.buy.noAccess")} />
      </>
    );
  }

  return (
    <>
      {header}
      <Tabs
        label={t("store2.buy.title")}
        value={current}
        onValueChange={(v) => onTab(v as BuyTab)}
        items={visible.map((id) => ({ id, label: t(`store2.buy.tabs.${id}`) }))}
      >
        {current === "indents" ? <IndentsTab /> : current === "orders" ? <OrdersTab /> : <ValueTab />}
      </Tabs>
    </>
  );
}
