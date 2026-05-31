import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Card, Chip, useThemeColor } from "heroui-native";
import { Pressable, ScrollView, Text, View } from "react-native";

import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { authClient } from "@/lib/auth-client";
import { TENANT_NAV } from "@/utils/navigation";
import { canAny, useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

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
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text className="text-3xl font-bold text-foreground" selectable>
          ORRN
        </Text>
        <Text className="text-muted text-sm" selectable>
          {me?.company?.name ?? "Manufactured inventory operations"}
        </Text>
      </View>

      <Card variant="secondary" className="p-4">
        <View className="flex-row items-center justify-between">
          <View style={{ gap: 4 }}>
            <Text className="text-foreground font-semibold" selectable>
              System Status
            </Text>
            <Text className="text-muted text-sm" selectable>
              {healthCheck.isLoading ? "Checking API…" : isConnected ? "API connected" : "API unavailable"}
            </Text>
          </View>
          <Chip variant="secondary" color={isConnected ? "success" : "danger"} size="sm">
            <Chip.Label>{isConnected ? "LIVE" : "OFFLINE"}</Chip.Label>
          </Chip>
        </View>
      </Card>

      {session?.user ? (
        <>
          <Card variant="secondary" className="p-4">
            <View className="flex-row items-center justify-between gap-3">
              <View style={{ flex: 1, gap: 4 }}>
                <Text className="text-foreground font-semibold" selectable>
                  {session.user.name}
                </Text>
                <Text className="text-muted text-sm" selectable>
                  {session.user.email}
                </Text>
              </View>
              <Pressable
                className="border border-border px-3 py-2 rounded-md active:opacity-70"
                onPress={async () => {
                  await authClient.signOut();
                  queryClient.clear();
                }}
              >
                <Text className="text-foreground font-medium">Sign Out</Text>
              </Pressable>
            </View>
          </Card>

          <View className="flex-row flex-wrap gap-3">
            {TENANT_NAV.filter((item) => {
              if (item.key === "home" || item.key === "members") return false;
              if (!item.requires) return true;
              return canAny(me, item.requires);
            }).map((module) => (
              <Link key={module.href} href={module.href as any} asChild>
                <Pressable className="w-[47%] border border-border rounded-md bg-card p-4 active:opacity-75">
                  <MaterialIcons name={module.icon as any} size={22} color={foregroundColor} />
                  <Text className="text-foreground font-semibold mt-3" selectable>
                    {module.label}
                  </Text>
                  <Text className="text-muted text-xs mt-1" selectable>
                    {module.description}
                  </Text>
                </Pressable>
              </Link>
            ))}
          </View>
        </>
      ) : (
        <>
          <Card variant="secondary" className="p-4">
            <View className="flex-row items-center">
              {healthCheck.isLoading ? <Ionicons name="hourglass-outline" size={20} color={mutedColor} /> : null}
              {!healthCheck.isLoading && isConnected ? <Ionicons name="checkmark-circle" size={20} color={successColor} /> : null}
              {!healthCheck.isLoading && !isConnected ? <Ionicons name="close-circle" size={20} color={dangerColor} /> : null}
              <Text className="text-muted text-sm ml-2" selectable>
                Sign in to access tenant-local ERP modules.
              </Text>
            </View>
          </Card>
          <SignIn />
          <SignUp />
        </>
      )}
    </ScrollView>
  );
}
