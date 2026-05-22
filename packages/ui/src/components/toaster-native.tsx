/**
 * Native toaster placeholder. We intentionally don't pull in Burnt yet — the
 * native screens currently use `Alert.alert` for feedback. When we want a
 * proper toast experience we can swap this for a Tamagui Toast or Burnt
 * adapter without touching call sites that import from this module.
 */
import { Stack } from "@orrn/ui/lib/tg";

export function ToasterNative() {
  return <Stack />;
}
