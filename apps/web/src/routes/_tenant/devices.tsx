import { createFileRoute } from "@tanstack/react-router";

import { DevicesScreen } from "@/features/devices/devices-screen";
import { parseDevicesSearch } from "@/features/devices/search";

/** `/devices?tab=devices|readings|weigh|lab|import|settings` (XE parity lane DEVICES); the devices tab when missing. */
export const Route = createFileRoute("/_tenant/devices")({
  validateSearch: (raw: Record<string, unknown>) => parseDevicesSearch(raw),
  component: DevicesRoute,
});

function DevicesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <DevicesScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
