import { createFileRoute } from "@tanstack/react-router";

import { SettlementPage } from "@/features/payroll/settlement-page";

export const Route = createFileRoute("/_tenant/payroll/settlement/$employeeId")({
  component: SettlementRoute,
});

function SettlementRoute() {
  const { employeeId } = Route.useParams();
  return <SettlementPage key={employeeId} employeeId={employeeId} />;
}
