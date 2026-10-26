import { useLocalSearchParams } from "expo-router";

import { BatchView } from "@/features/ageing/batch-view";

/** One ageing batch: the stage stepper and the one next action. */
export default function AgeingBatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BatchView id={String(id)} />;
}
