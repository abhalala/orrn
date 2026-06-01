import { Button } from "@orrn/ui/components/button";
import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not Found" }} />
      <Container>
        <View className="flex-1 items-center justify-center p-4">
          <View className="max-w-sm items-center rounded-lg border border-border bg-card p-6">
            <Text className="mb-3 text-4xl">🤔</Text>
            <Text className="mb-1 text-lg font-medium text-foreground">Page Not Found</Text>
            <Text className="mb-4 text-center text-sm text-muted-foreground">
              The page you're looking for doesn't exist.
            </Text>
            <Link href="/" asChild>
              <Button size="sm">Go Home</Button>
            </Link>
          </View>
        </View>
      </Container>
    </>
  );
}
