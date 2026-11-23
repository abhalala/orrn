import { NotForYou } from "@/features/me/home-view";
import { LeaveView } from "@/features/me/leave-view";
import { moreRouteAccess } from "@/features/more/access";
import { useMe } from "@/utils/me";

/** More > My work > Leave: ask for leave, my requests, cancel a waiting one. */
export default function MyLeaveScreen() {
  const { data: me } = useMe();
  return moreRouteAccess(me, "me") === "allowed" ? <LeaveView /> : <NotForYou />;
}
