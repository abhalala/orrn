import { ScanView } from "@/features/scan/scan-view";

/**
 * The Scan tab. With `dispatchId` and `code` params it scans into that
 * building dispatch; without them it looks a bundle up (features/scan/scan-view.tsx).
 */
export default function ScanScreen() {
  return <ScanView />;
}
