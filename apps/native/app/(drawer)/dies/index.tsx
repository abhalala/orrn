import { useQuery } from "@tanstack/react-query";
import { Stack, Link } from "expo-router";
import { useState } from "react";
import { FlatList } from "react-native";
import { format } from "date-fns";
import { Badge } from "@orrn/ui/components/badge";

import {
  ErpCardPressable,
  ErpEmpty,
  ErpLoading,
  ErpMutedText,
  ErpRowBetween,
  ErpScreen,
  ErpSearchBar,
  ErpTitleText,
} from "@/components/erp";
import { trpc } from "../../../utils/trpc";

export default function DiesScreen() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.die.list.queryOptions({ search, limit: 50, offset: 0 }),
  });

  return (
    <ErpScreen>
      <Stack.Screen options={{ title: "Dies" }} />

      <ErpSearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search by name, series, section..."
      />

      {isLoading ? (
        <ErpLoading />
      ) : (
        <FlatList
          data={data?.items || []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-4 gap-3"
          renderItem={({ item }) => (
            <Link href={`/dies/${item.id}`} asChild>
              <ErpCardPressable>
                <ErpRowBetween>
                  <ErpTitleText>{item.series}</ErpTitleText>
                  <Badge tone={item.status === "active" ? "success" : "neutral"}>
                    {item.status}
                  </Badge>
                </ErpRowBetween>
                <ErpMutedText className="font-medium text-foreground">
                  Section: {item.sectionCode}
                </ErpMutedText>
                {item.name ? <ErpMutedText>{item.name}</ErpMutedText> : null}
                <ErpMutedText>
                  Weight: {item.weightMinG}g - {item.weightMaxG}g
                </ErpMutedText>
                <ErpMutedText className="mt-2 text-xs">
                  Created {format(new Date(item.createdAt), "MMM d, yyyy")}
                </ErpMutedText>
              </ErpCardPressable>
            </Link>
          )}
          ListEmptyComponent={
            <ErpEmpty>
              {search ? "No dies found matching search." : "No dies yet."}
            </ErpEmpty>
          }
        />
      )}
    </ErpScreen>
  );
}
