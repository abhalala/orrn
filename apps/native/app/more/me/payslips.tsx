import { NotForYou } from "@/features/me/home-view";
import { PayslipsView } from "@/features/me/payslips-view";
import { moreRouteAccess } from "@/features/more/access";
import { useMe } from "@/utils/me";

/** More > My work > My payslips: only when the payroll module is on. */
export default function MyPayslipsScreen() {
  const { data: me } = useMe();
  return moreRouteAccess(me, "payslips") === "allowed" ? <PayslipsView /> : <NotForYou />;
}
