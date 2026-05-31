import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Stack } from "expo-router";
import { FlatList, Text } from "react-native";

import {
  ErpEmpty,
  ErpListCard,
  ErpLoading,
  ErpMutedText,
  ErpScreen,
  ErpTitleText,
} from "@/components/erp";

/**
 * Read-only waitlist review for platform admins. Approve/reject stays web-only.
 */
export default function PlatformWaitlistScreen() {
  const { data: requests, isLoading, error } = useQuery(trpc.platform.waitlistList.queryOptions());

  if (isLoading) {
    return (
      <ErpScreen>
        <ErpLoading />
      </ErpScreen>
    );
  }

  if (error) {
    return (
      <ErpScreen className="items-center justify-center">
        <Text className="text-danger">Unable to load waitlist.</Text>
      </ErpScreen>
    );
  }

  return (
    <ErpScreen>
      <Stack.Screen options={{ title: "Waitlist" }} />
      <ErpMutedText className="px-4 pb-1 pt-3">
        Read-only on mobile — approve or reject from the web console.
      </ErpMutedText>
      <FlatList
        data={requests ?? []}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 gap-3"
        renderItem={({ item }) => (
          <ErpListCard>
            <ErpTitleText>{item.companyName}</ErpTitleText>
            <ErpMutedText>
              {item.requesterName} · {item.requesterEmail}
            </ErpMutedText>
            <ErpMutedText className="mt-1.5 text-xs">
              {format(new Date(item.createdAt), "MMM d, yyyy")}
            </ErpMutedText>
            {item.notes ? <ErpMutedText className="mt-2">{item.notes}</ErpMutedText> : null}
          </ErpListCard>
        )}
        ListEmptyComponent={
          <ErpEmpty>No pending waitlist requests.</ErpEmpty>
        }
      />
    </ErpScreen>
  );
}
