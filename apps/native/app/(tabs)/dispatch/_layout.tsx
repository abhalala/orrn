import { TabStack } from "@/components/tab-stack";

/** Deep links to a detail screen still get the list underneath for Back. */
export const unstable_settings = { initialRouteName: "index" };

export default function DispatchStack() {
  return <TabStack titleKey="nav.dispatch" />;
}
