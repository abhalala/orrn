/**
 * Native toaster placeholder. The native screens currently surface feedback
 * via `Alert.alert`; this component is kept as a no-op import target so
 * cross-platform code that imports it still resolves cleanly.
 */
export function ToasterNative() {
  return null;
}
