import { createFileRoute } from "@tanstack/react-router";

import { PressScreen } from "@/features/preview/press/components/chrome";
import { PressStation } from "@/features/preview/press/components/station";

export const Route = createFileRoute("/_tenant/preview/press/console")({
  validateSearch: (search: Record<string, unknown>): { run?: "PR-43" | "PR-42" } =>
    search.run === "PR-43" || search.run === "PR-42" ? { run: search.run } : {},
  component: PressConsolePage,
});

function PressConsolePage() {
  const { run } = Route.useSearch();
  const runId = run ?? "PR-42";
  return (
    <PressScreen
      title="Press station"
      summary={
        runId === "PR-43"
          ? "PR-43 is queued. Start is locked until the die room issues a copy."
          : "PR-42 on the tablet. Count, then the supervisor logs."
      }
      featureIds={[
        "FP-PR-03",
        "FP-PR-04",
        "FP-PR-05",
        "FP-PR-06",
        "FP-PR-07",
        "FP-PR-08",
        "FP-PR-09",
        "FP-PR-10",
        "FP-PR-11",
        "FP-PR-12",
        "FP-PR-13",
        "FP-PR-14",
        "FP-PR-15",
        "FP-PR-16",
        "FP-PR-20",
      ]}
    >
      <PressStation runId={runId} />
    </PressScreen>
  );
}
