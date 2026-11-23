import { useLocalSearchParams } from "expo-router";

import { NotForYou } from "@/features/me/home-view";
import { PayslipView } from "@/features/me/payslip-view";
import { moreRouteAccess } from "@/features/more/access";
import { useMe } from "@/utils/me";

/** One payslip of mine, every line explained. */
export default function MyPayslipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: me } = useMe();
  return moreRouteAccess(me, "payslips") === "allowed" ? <PayslipView id={String(id)} /> : <NotForYou />;
}
