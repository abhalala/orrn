import { Component, type ReactNode } from "react";

/**
 * Keeps a failed chart download (a tab left open across a deploy, a dropped
 * connection) inside the chart area: without it the lazy import's error goes
 * up to the route and takes the sections grid with it.
 */
export class ChartsBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
