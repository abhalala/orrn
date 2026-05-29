import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

import { Paragraph, Stack, Text, XStack, YStack } from "@orrn/ui/lib/tg";

/**
 * SaaS-style left navigation sidebar. Collapse state is persisted in
 * localStorage under a versioned key so callers can bump the version when the
 * layout meaningfully changes.
 *
 * Designed to be web-first (uses window.localStorage); native uses a Drawer
 * instead.
 */
export type SidebarProps = {
  brand: ReactNode;
  children: ReactNode;
  storageKey?: string;
  footer?: ReactNode;
};

const COLLAPSED_WIDTH = 64;
const EXPANDED_WIDTH = 240;

type SidebarContextValue = { collapsed: boolean; toggle: () => void };
const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, toggle: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

export function Sidebar({ brand, children, storageKey = "orrn:sidebar:v1", footer }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return false;
      return stored === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      // Ignore storage failures (private mode, quota).
    }
  }, [collapsed, storageKey]);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed((v) => !v) }}>
      <YStack
        width={collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH}
        height="100%"
        backgroundColor="$backgroundStrong"
        borderRightWidth={1}
        borderRightColor="$borderColor"
        paddingVertical={16}
        gap={16}
      >
        <XStack
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal={collapsed ? 12 : 16}
          gap={8}
        >
          {brand}
        </XStack>
        <YStack flex={1} paddingHorizontal={8} gap={4} overflow="scroll">
          {children}
        </YStack>
        {footer ? (
          <YStack paddingHorizontal={collapsed ? 8 : 12} gap={8}>
            {footer}
          </YStack>
        ) : null}
        <XStack
          paddingHorizontal={collapsed ? 8 : 12}
          alignItems="center"
          justifyContent="flex-end"
        >
          <Stack
            cursor="pointer"
            onPress={() => setCollapsed((v) => !v)}
            paddingHorizontal={8}
            paddingVertical={6}
            borderRadius={6}
            hoverStyle={{ backgroundColor: "$backgroundHover" }}
          >
            <Text fontSize={11} color="$mutedFg">
              {collapsed ? "›" : "‹ Collapse"}
            </Text>
          </Stack>
        </XStack>
      </YStack>
    </SidebarContext.Provider>
  );
}

export type SidebarSectionProps = {
  label?: ReactNode;
  children: ReactNode;
};

export function SidebarSection({ label, children }: SidebarSectionProps) {
  const { collapsed } = useSidebar();
  return (
    <YStack gap={2}>
      {label && !collapsed ? (
        <Paragraph
          fontSize={10}
          color="$mutedFg"
          textTransform="uppercase"
          letterSpacing={0.8}
          paddingHorizontal={10}
          paddingVertical={6}
          margin={0}
        >
          {label}
        </Paragraph>
      ) : null}
      <YStack gap={2}>{children}</YStack>
    </YStack>
  );
}

export type SidebarItemProps = {
  active?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  onPress?: () => void;
  testID?: string;
};

export function SidebarItem({ active, icon, children, onPress, testID }: SidebarItemProps) {
  const { collapsed } = useSidebar();
  return (
    <XStack
      testID={testID}
      onPress={onPress}
      cursor={onPress ? "pointer" : undefined}
      alignItems="center"
      paddingHorizontal={collapsed ? 0 : 10}
      paddingVertical={8}
      borderRadius={8}
      borderLeftWidth={3}
      borderLeftColor={active ? "$primary" : "transparent"}
      backgroundColor={active ? "$backgroundHover" : "transparent"}
      hoverStyle={{ backgroundColor: "$backgroundHover" }}
      gap={collapsed ? 0 : 10}
      justifyContent={collapsed ? "center" : "flex-start"}
    >
      {icon ? (
        <Stack width={20} alignItems="center" justifyContent="center">
          <Text color={active ? "$primary" : "$mutedFg"}>{icon}</Text>
        </Stack>
      ) : null}
      {!collapsed ? (
        <Text
          fontSize={13}
          fontWeight={active ? "600" : "500"}
          color={active ? "$color" : "$mutedFg"}
        >
          {children}
        </Text>
      ) : null}
    </XStack>
  );
}
