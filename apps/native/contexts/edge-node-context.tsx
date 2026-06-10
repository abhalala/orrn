import { buildLocalEdgePaths, type EdgeNodeConfig, type LocalEdgePaths } from "@orrn/edge-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { loadEdgeNodeConfig, saveEdgeNodeConfig, clearEdgeNodeConfig } from "@/lib/edge-node-store";
import { useMe } from "@/utils/me";

type EdgeNodeContextValue = {
  isLoading: boolean;
  config: EdgeNodeConfig | null;
  localPaths: LocalEdgePaths | null;
  error: string | null;
  saveConfig: (config: EdgeNodeConfig) => Promise<void>;
  clearConfig: () => Promise<void>;
};

const EdgeNodeContext = createContext<EdgeNodeContextValue | null>(null);

export function EdgeNodeProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const companyId = me?.company?.id ?? null;
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<EdgeNodeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!companyId) {
        if (!cancelled) {
          setConfig(null);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const next = await loadEdgeNodeConfig(companyId);
        if (!cancelled) {
          setConfig(next);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setConfig(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load edge node config");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const saveConfigValue = useCallback(async (next: EdgeNodeConfig) => {
    await saveEdgeNodeConfig(next);
    setConfig(next);
    setError(null);
  }, []);

  const clearConfigValue = useCallback(async () => {
    if (!companyId) {
      setConfig(null);
      return;
    }
    await clearEdgeNodeConfig(companyId);
    setConfig(null);
    setError(null);
  }, [companyId]);

  const localPaths = useMemo(() => {
    if (!config) {
      return null;
    }
    return buildLocalEdgePaths("edge-runtime", config.subdomain);
  }, [config]);

  const value = useMemo<EdgeNodeContextValue>(
    () => ({
      isLoading,
      config,
      localPaths,
      error,
      saveConfig: saveConfigValue,
      clearConfig: clearConfigValue,
    }),
    [clearConfigValue, config, error, isLoading, localPaths, saveConfigValue],
  );

  return <EdgeNodeContext.Provider value={value}>{children}</EdgeNodeContext.Provider>;
}

export function useEdgeNode() {
  const value = useContext(EdgeNodeContext);
  if (!value) {
    throw new Error("useEdgeNode must be used within EdgeNodeProvider");
  }
  return value;
}
