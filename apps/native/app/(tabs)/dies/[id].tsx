import { useLocalSearchParams } from "expo-router";

import { CopyCard } from "@/features/dies/copy-card";

export default function DieCopyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CopyCard id={id ?? ""} />;
}
