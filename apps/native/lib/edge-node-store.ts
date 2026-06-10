import type { EdgeNodeConfig } from "@orrn/edge-runtime";
import { edgeNodeConfigSchema } from "@orrn/edge-runtime";
import * as SecureStore from "expo-secure-store";

function edgeStorageKey(companyId: string) {
  return `edge-node-config:${companyId}`;
}

export async function loadEdgeNodeConfig(companyId: string) {
  const raw = await SecureStore.getItemAsync(edgeStorageKey(companyId));
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as unknown;
  return edgeNodeConfigSchema.parse(parsed);
}

export async function saveEdgeNodeConfig(config: EdgeNodeConfig) {
  await SecureStore.setItemAsync(edgeStorageKey(config.companyId), JSON.stringify(config));
}

export async function clearEdgeNodeConfig(companyId: string) {
  await SecureStore.deleteItemAsync(edgeStorageKey(companyId));
}
