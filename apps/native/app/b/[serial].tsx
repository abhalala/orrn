import { BundleScreen } from "@/features/bundle/bundle-screen";

/**
 * A bundle: what a label QR and a scan open. A root screen (outside the tabs),
 * so the header has the phone's own Back. Writes (void, restore, add to a
 * dispatch) are in features/bundle and report failures through `saveErrorText(t, error)` and `writeFailureKind(error)` (unsure vs failed).
 */
export default function BundleRoute() {
  return <BundleScreen />;
}
