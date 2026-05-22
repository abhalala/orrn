import { Pressable, Text, View } from "react-native";

import { useMe } from "@/utils/me";
import { queryClient } from "@/utils/trpc";

/**
 * Native parity with web's ImpersonationBanner. Renders a red strip across the
 * top of every screen when the user is acting under an impersonation header.
 */
export function ImpersonationBanner() {
  const { data: me } = useMe();
  if (!me?.impersonation) return null;

  return (
    <View className="w-full bg-red-600 px-4 py-2 flex-row items-center justify-between">
      <View className="flex-1 mr-2">
        <Text className="text-white text-sm">
          <Text className="font-semibold">Impersonating</Text>{" "}
          {me.company ? me.company.name : me.impersonation.companyId}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        className="bg-white rounded px-3 py-1"
        onPress={() => {
          queryClient.removeQueries({ queryKey: ["auth.me"] });
          // The actual impersonation header is sent only by the admin UI in
          // M9; here, dropping the cached me triggers a re-fetch as ourselves.
        }}
      >
        <Text className="text-red-700 text-xs font-semibold">Stop</Text>
      </Pressable>
    </View>
  );
}
