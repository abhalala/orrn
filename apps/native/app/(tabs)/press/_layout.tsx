import { TabStack } from "@/components/tab-stack";

export const unstable_settings = { initialRouteName: "index" };

export default function PressStack() {
  return <TabStack titleKey="native.tabs.press" />;
}
