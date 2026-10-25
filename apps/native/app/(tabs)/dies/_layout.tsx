import { TabStack } from "@/components/tab-stack";

/** Deep links to a card still get the list underneath for Back. */
export const unstable_settings = { initialRouteName: "index" };

export default function DiesStack() {
  return <TabStack titleKey="nav.dies" />;
}
