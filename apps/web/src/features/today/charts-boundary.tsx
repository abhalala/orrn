import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Component, type ErrorInfo, type ReactNode } from "react";

/** What shows when the charts' code itself can't load: one card, and the fix (a reload fetches the current build). */
function ChartsFailed() {
  const { t } = useT();
  return (
    <section
      data-testid="today-charts-failed"
      aria-label={t("today.trendsHeading")}
      className="min-w-0 rounded-card border border-border bg-card"
    >
      <EmptyState
        className="py-8"
        title={t("today.chartsErrorTitle")}
        body={t("today.chartsErrorBody")}
        action={
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {t("today.reloadPage")}
          </Button>
        }
      />
    </section>
  );
}

/**
 * Keeps Today's numbers and lists on screen when the lazy chart chunk fails
 * to load (a flaky link, or a deploy that removed the old file while a tab
 * was open). Without it the router's default error page replaces the route.
 */
export class ChartsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Today charts failed to load", error, info.componentStack);
  }

  override render() {
    return this.state.failed ? <ChartsFailed /> : this.props.children;
  }
}
