import { Stack } from "expo-router";

import { useStackOptions } from "@/lib/screen-options";

/** Signed-out screens. Sign-in draws its own chrome. */
export default function AuthLayout() {
  const options = useStackOptions();
  return (
    <Stack screenOptions={{ ...options, headerShown: false }}>
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}
