import { createFileRoute } from "@tanstack/react-router";

import { BankPage } from "@/features/masters/bank-page";

export const Route = createFileRoute("/_tenant/masters/bank")({
  component: BankPage,
});
