import { TabStack } from "@/components/tab-stack";

/** Deep links to an order or the booking form still get the list underneath for Back. */
export const unstable_settings = { initialRouteName: "index" };

export default function OrdersStack() {
  return <TabStack titleKey="nav.orders" />;
}
