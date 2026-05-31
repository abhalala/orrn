import { trpc } from "../../utils/trpc";
import { FlatList } from "react-native";
import { format } from "date-fns";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@orrn/ui/components/badge";

import {
  ErpEmpty,
  ErpListCard,
  ErpLoading,
  ErpMutedText,
  ErpRowBetween,
  ErpScreen,
  ErpTitleText,
} from "@/components/erp";

export default function MembersScreen() {
  const { data: members, isLoading } = useQuery(trpc.company.membersList.queryOptions());

  if (isLoading) {
    return (
      <ErpScreen>
        <ErpLoading />
      </ErpScreen>
    );
  }

  return (
    <ErpScreen>
      <Stack.Screen options={{ title: "Team Members" }} />
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 gap-3"
        renderItem={({ item }) => (
          <ErpListCard>
            <ErpRowBetween>
              <ErpTitleText>{item.user.name}</ErpTitleText>
              <StatusBadge kind="role" value={item.role} />
            </ErpRowBetween>
            <ErpMutedText>{item.user.email}</ErpMutedText>
            <ErpMutedText className="text-xs">
              Joined {format(new Date(item.createdAt), "MMM d, yyyy")}
            </ErpMutedText>
          </ErpListCard>
        )}
        ListEmptyComponent={<ErpEmpty>No members found.</ErpEmpty>}
      />
    </ErpScreen>
  );
}
