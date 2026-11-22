import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Sheet } from "@orrn/ui/components/sheet";
import { Link } from "@tanstack/react-router";
import { ClipboardList, Receipt } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";

import { MakeProformaButton, ProformaList } from "./proforma-panel";
import { usePricingOn } from "./use-docs";

/**
 * The pricing documents of a confirmed order, beside the order's print buttons: the works order (every member), a
 * proforma (`quote.manage`) and the proformas already made (`price.view`). Nothing shows for an order that is not
 * confirmed yet, or on a plant that has the pricing module off.
 */
export function OrderDocActions({ orderId, status }: { orderId: string; status: string }) {
  const { t } = useT();
  const on = usePricingOn();
  const [listOpen, setListOpen] = useState(false);
  if (!on || (status !== "confirmed" && status !== "dispatching")) return null;
  return (
    <>
      <Button variant="secondary" asChild>
        <Link to="/orders/$id/works-order" params={{ id: orderId }} data-works-order-link="">
          <ClipboardList aria-hidden="true" strokeWidth={2} />
          {t("price.worksOrder.open")}
        </Link>
      </Button>
      <MakeProformaButton source={{ source: "order", id: orderId }} />
      <Can do="price.view">
        <Button variant="secondary" onClick={() => setListOpen(true)} aria-haspopup="dialog">
          <Receipt aria-hidden="true" strokeWidth={2} />
          {t("price.proforma.previous")}
        </Button>
        <Sheet open={listOpen} onOpenChange={setListOpen} title={t("price.proforma.previous")} description={t("price.proforma.sheetHint")}>
          {listOpen ? <ProformaList source={{ source: "order", id: orderId }} /> : null}
        </Sheet>
      </Can>
    </>
  );
}
