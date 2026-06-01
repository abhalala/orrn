import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { cssInterop } from "nativewind";
import { Pressable, ScrollView, Text, View } from "react-native";

import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { authClient } from "@/lib/auth-client";
import { useThemeColor } from "@/lib/theme";
import { TENANT_NAV } from "@/utils/navigation";
import { canAny, useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

const StyledIonicons = cssInterop(Ionicons, {
  className: { target: "style", nativeStyleToProp: { color: true } },
});

export default function Home() {
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());
  const { data: session } = authClient.useSession();
  const { data: me } = useMe();
  const isConnected = healthCheck?.data === "OK";
  const mutedColor = useThemeColor("muted");
  const successColor = useThemeColor("success");
  const dangerColor = useThemeColor("danger");
  const foregroundColor = useThemeColor("foreground");

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, gap: 16 }}
    >
      <View style={{ gap: 4 }}>
        <Text className="text-3xl font-bold text-foreground" selectable>
          ORRN
        </Text>
        <Text className="text-sm text-muted-foreground" selectable>
          {me?.company?.name ?? "Manufactured inventory operations"}
        </Text>
      </View>

      <View className="rounded-lg border border-border bg-card p-4">
        <View className="flex-row items-center justify-between">
          <View style={{ gap: 4 }}>
            <Text className="font-semibold text-foreground" selectable>
              System Status
            </Text>
            <Text className="text-sm text-muted-foreground" selectable>
              {healthCheck.isLoading
                ? "Checking API…"
                : isConnected
                  ? "API connected"
                  : "API unavailable"}
            </Text>
          </View>
          <View
            className={`rounded-full px-2.5 py-1 ${
              isConnected ? "bg-emerald-100" : "bg-rose-100"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                isConnected ? "text-emerald-800" : "text-rose-800"
              }`}
            >
              {isConnected ? "LIVE" : "OFFLINE"}
            </Text>
          </View>
        </View>
      </View>

      {session?.user ? (
        <>
          <View className="rounded-lg border border-border bg-card p-4">
            <View className="flex-row items-center justify-between gap-3">
              <View style={{ flex: 1, gap: 4 }}>
                <Text className="font-semibold text-foreground" selectable>
                  {session.user.name}
                </Text>
                <Text className="text-sm text-muted-foreground" selectable>
                  {session.user.email}
                </Text>
              </View>
              <Pressable
                className="rounded-md border border-border px-3 py-2 active:opacity-70"
                onPress={async () => {
                  await authClient.signOut();
                  queryClient.clear();
                }}
              >
                <Text className="font-medium text-foreground">Sign Out</Text>
              </Pressable>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-3">
            {TENANT_NAV.filter((item) => {
              if (item.key === "home" || item.key === "members") return false;
              if (!item.requires) return true;
              return canAny(me, item.requires);
            }).map((module) => (
              <Link key={module.href} href={module.href as any} asChild>
                <Pressable className="w-[47%] rounded-md border border-border bg-card p-4 active:opacity-75">
                  <MaterialIcons
                    name={module.icon as any}
                    size={22}
                    color={foregroundColor}
                  />
                  <Text className="mt-3 font-semibold text-foreground" selectable>
                    {module.label}
                  </Text>
                  <Text className="mt-1 text-xs text-muted-foreground" selectable>
                    {module.description}
                  </Text>
                </Pressable>
              </Link>
            ))}
          </View>
        </>
      ) : (
        <>
          <View className="rounded-lg border border-border bg-card p-4">
            <View className="flex-row items-center">
              {healthCheck.isLoading ? (
                <StyledIonicons name="hourglass-outline" size={20} color={mutedColor} />
              ) : null}
              {!healthCheck.isLoading && isConnected ? (
                <StyledIonicons name="checkmark-circle" size={20} color={successColor} />
              ) : null}
              {!healthCheck.isLoading && !isConnected ? (
                <StyledIonicons name="close-circle" size={20} color={dangerColor} />
              ) : null}
              <Text className="ml-2 text-sm text-muted-foreground" selectable>
                Sign in to access tenant-local ERP modules.
              </Text>
            </View>
          </View>
          <SignIn />
          <SignUp />
        </>
      )}
    </ScrollView>
  );
}
