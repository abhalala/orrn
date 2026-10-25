import { TabStack } from "@/components/tab-stack";

export const unstable_settings = { initialRouteName: "index" };

export default function CastStack() {
  return <TabStack titleKey="foundry.casts.title" />;
}
