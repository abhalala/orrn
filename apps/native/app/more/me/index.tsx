import { HomeView, NotForYou } from "@/features/me/home-view";
import { moreRouteAccess } from "@/features/more/access";
import { useMe } from "@/utils/me";

/** More > My work: my attendance this month, leave balances, and the doors to leave and payslips. */
export default function MyWorkScreen() {
  const { data: me } = useMe();
  return moreRouteAccess(me, "me") === "allowed" ? <HomeView /> : <NotForYou />;
}
