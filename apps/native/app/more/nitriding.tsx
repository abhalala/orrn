import { NitridingView } from "@/features/dies/work-lists";
import { moreRouteAccess } from "@/features/more/access";
import { MoreAccessGate } from "@/features/more/access-gate";
import { useMe } from "@/utils/me";

export default function NitridingScreen() {
  const { data: me } = useMe();
  return <MoreAccessGate access={moreRouteAccess(me, "nitriding")}><NitridingView /></MoreAccessGate>;
}
