import { createFileRoute } from "@tanstack/react-router";

import { requireErpEntry } from "@orrn/web-shared/lib/erp-guards";

export const Route = createFileRoute("/")({
  beforeLoad: requireErpEntry,
  component: () => null,
});
