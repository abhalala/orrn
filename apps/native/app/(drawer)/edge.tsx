import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Pressable, Text, View } from "react-native";
import { useState } from "react";

import { Can } from "@/components/can";
import {
  ErpCardPressable,
  ErpEmpty,
  ErpField,
  ErpKvRow,
  ErpListCard,
  ErpLoading,
  ErpMutedText,
  ErpScreen,
  ErpSectionTitle,
  ErpTextInput,
  ErpTitleText,
} from "@/components/erp";
import { useEdgeNode } from "@/contexts/edge-node-context";
import { useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

export default function EdgeScreen() {
  const { data: me } = useMe();
  const overview = useQuery(trpc.edge.overview.queryOptions());
  const { config, localPaths, isLoading: isBootstrapLoading, error: bootstrapError, saveConfig, clearConfig } = useEdgeNode();
  const [nodeName, setNodeName] = useState("Primary edge node");
  const [siteLabel, setSiteLabel] = useState(me?.company?.name ? `${me.company.name} Main facility` : "Main facility");

  const enrollMutation = useMutation({
    ...trpc.edge.enroll.mutationOptions(),
    onSuccess: async (result) => {
      await saveConfig(result.config);
      await queryClient.invalidateQueries({ queryKey: trpc.edge.overview.queryKey() });
      Alert.alert("Edge node enrolled", `${result.deployment.nodeName} is ready to bootstrap locally.`);
    },
    onError: (error) => {
      Alert.alert("Enrollment failed", error.message || "Could not enroll edge node");
    },
  });

  const revokeMutation = useMutation({
    ...trpc.edge.revoke.mutationOptions(),
    onSuccess: async () => {
      await clearConfig();
      await queryClient.invalidateQueries({ queryKey: trpc.edge.overview.queryKey() });
      Alert.alert("Edge node revoked", "The local edge node credentials were removed.");
    },
    onError: (error) => {
      Alert.alert("Revoke failed", error.message || "Could not revoke edge node");
    },
  });

  const currentNode = overview.data?.current ?? null;

  if (!me?.company) {
    return (
      <ErpScreen className="p-4">
        <ErpEmpty>Join a company to enroll an edge node.</ErpEmpty>
      </ErpScreen>
    );
  }

  if (overview.isLoading || isBootstrapLoading) {
    return <ErpLoading />;
  }

  return (
    <ErpScreen className="gap-4 p-4">
      <View className="gap-1">
        <ErpTitleText>Edge node</ErpTitleText>
        <ErpMutedText>
          Native shell for offline floor work, local print queueing, and reconnect sync for {me.company.name}.
        </ErpMutedText>
      </View>

      {bootstrapError ? (
        <ErpListCard>
          <Text className="font-medium text-danger">Stored runtime config is invalid</Text>
          <ErpMutedText>{bootstrapError}</ErpMutedText>
        </ErpListCard>
      ) : null}

      <ErpListCard>
        <ErpSectionTitle>Local runtime</ErpSectionTitle>
        <View className="mt-3 gap-2">
          <ErpKvRow label="Stored node" value={config?.nodeName ?? "Not enrolled on this device"} />
          <ErpKvRow label="Site" value={config?.siteLabel ?? "—"} />
          <ErpKvRow label="Domain" value={config?.nodeDomain ?? "—"} />
          <ErpKvRow label="Data path" value={localPaths?.databasePath ?? "Will be created on bootstrap"} />
          <ErpKvRow label="Journal path" value={localPaths?.journalPath ?? "Will be created on bootstrap"} />
        </View>
      </ErpListCard>

      <ErpListCard>
        <ErpSectionTitle>Server state</ErpSectionTitle>
        <View className="mt-3 gap-2">
          <ErpKvRow label="Current node" value={currentNode?.nodeName ?? "No node enrolled yet"} />
          <ErpKvRow label="Status" value={currentNode?.status ?? "—"} />
          <ErpKvRow label="Last heartbeat" value={currentNode?.lastHeartbeatAt ? new Date(currentNode.lastHeartbeatAt).toLocaleString() : "Never"} />
          <ErpKvRow label="Runtime version" value={currentNode?.runtimeVersion ?? "—"} />
        </View>
      </ErpListCard>

      <Can do="edge.manage" fallback={<ErpMutedText>You need manager access or higher to enroll a node.</ErpMutedText>}>
        <ErpListCard>
          <ErpSectionTitle>Enroll this device</ErpSectionTitle>
          <View className="mt-3 gap-3">
            <ErpField label="Node name">
              <ErpTextInput value={nodeName} onChangeText={setNodeName} placeholder="Primary edge node" />
            </ErpField>
            <ErpField label="Site / location">
              <ErpTextInput value={siteLabel} onChangeText={setSiteLabel} placeholder="Main facility" />
            </ErpField>
            <ErpCardPressable
              onPress={() =>
                enrollMutation.mutate({
                  nodeName,
                  siteLabel,
                  runtimeFlavor: "native",
                  runtimePlatform: "expo",
                })
              }
            >
              <Text className="font-semibold text-foreground">
                {enrollMutation.isPending ? "Enrolling…" : "Enroll local edge node"}
              </Text>
              <ErpMutedText>Backend provisions tunnel, DNS, and node credentials after authenticated enrollment.</ErpMutedText>
            </ErpCardPressable>
            {config ? (
              <Pressable
                className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3"
                onPress={() => revokeMutation.mutate({ id: config.deploymentId })}
              >
                <Text className="font-semibold text-danger">
                  {revokeMutation.isPending ? "Revoking…" : "Revoke local node"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </ErpListCard>
      </Can>

      <View className="gap-2">
        <ErpSectionTitle>Known nodes</ErpSectionTitle>
        {(overview.data?.nodes ?? []).length === 0 ? (
          <ErpEmpty>No nodes enrolled yet.</ErpEmpty>
        ) : (
          overview.data?.nodes.map((node) => (
            <ErpListCard key={node.id}>
              <ErpKvRow label="Node" value={node.nodeName} />
              <ErpKvRow label="Site" value={node.siteLabel} />
              <ErpKvRow label="Domain" value={node.nodeDomain} />
              <ErpKvRow label="Status" value={node.status} />
            </ErpListCard>
          ))
        )}
      </View>
    </ErpScreen>
  );
}
