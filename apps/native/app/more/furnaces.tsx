import { FurnacesView } from "@/features/foundry/masters-view";
import { moreRouteAccess } from "@/features/more/access";
import { MoreAccessGate } from "@/features/more/access-gate";
import { useMe } from "@/utils/me";

export default function FurnacesScreen() {
  const { data: me } = useMe();
  return <MoreAccessGate access={moreRouteAccess(me, "furnaces")}><FurnacesView /></MoreAccessGate>;
}
