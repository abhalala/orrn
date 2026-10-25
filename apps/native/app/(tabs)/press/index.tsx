import { PressDesk } from "@/features/dies/press-desk";
import { PressLines } from "@/features/press/lines-view";
import { tabSetFor } from "@/lib/nav";
import { useMe } from "@/utils/me";

/**
 * The Press tab. The die room's is its desk (which queued runs wait for a die, and the issue itself); every
 * other role reads the plant's press lines: what each is running, its queue, downtime and handover.
 */
export default function PressScreen() {
  const { data: me } = useMe();
  return tabSetFor(me) === "dieRoom" ? <PressDesk /> : <PressLines />;
}
