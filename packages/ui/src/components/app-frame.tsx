import type { ReactNode } from "react";

import { H1, Paragraph, Stack, Text, XStack, YStack } from "@orrn/ui/lib/tg";

import { Button } from "./button";

export type AppFrameNavItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  href?: string;
  onPress?: () => void;
  hidden?: boolean;
};

export type AppStatusBarProps = {
  brand?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  navToggle?: ReactNode;
};

export function AppStatusBar({ brand, context, actions, navToggle }: AppStatusBarProps) {
  return (
    <XStack
      alignItems="center"
      justifyContent="space-between"
      gap={12}
      minHeight={56}
      paddingHorizontal={16}
      borderBottomWidth={1}
      borderBottomColor="$borderColor"
      backgroundColor="$backgroundStrong"
    >
      <XStack alignItems="center" gap={10} minWidth={0} flex={1}>
        {navToggle}
        {brand}
        {context ? (
          <XStack alignItems="center" gap={8} minWidth={0} flex={1}>
            {context}
          </XStack>
        ) : null}
      </XStack>
      {actions ? (
        <XStack alignItems="center" gap={8} flexShrink={0}>
          {actions}
        </XStack>
      ) : null}
    </XStack>
  );
}

export type AppFrameProps = {
  children: ReactNode;
  sidebar?: ReactNode;
  statusBar?: ReactNode;
  mobileNav?: ReactNode;
  banner?: ReactNode;
  maxWidth?: number | string;
};

export function AppFrame({
  children,
  sidebar,
  statusBar,
  mobileNav,
  banner,
  maxWidth = 1180,
}: AppFrameProps) {
  return (
    <YStack height="100svh" width="100%" backgroundColor="$background">
      {banner}
      <XStack flex={1} minHeight={0} width="100%" overflow="hidden">
        {sidebar ? <Stack className="orrn-desktop-nav" height="100%">{sidebar}</Stack> : null}
        <YStack flex={1} minWidth={0}>
          {statusBar}
          <Stack flex={1} overflow="auto">
            <YStack
              width="100%"
              maxWidth={maxWidth}
              alignSelf="center"
              paddingHorizontal={16}
              paddingVertical={20}
              paddingBottom={mobileNav ? 84 : 24}
              gap={16}
            >
              {children}
            </YStack>
          </Stack>
          {mobileNav}
        </YStack>
      </XStack>
    </YStack>
  );
}

export type PageScaffoldProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageScaffold({
  title,
  description,
  eyebrow,
  actions,
  children,
}: PageScaffoldProps) {
  return (
    <YStack gap={16}>
      <XStack alignItems="flex-start" justifyContent="space-between" gap={12} flexWrap="wrap">
        <YStack gap={4} minWidth={220} flex={1}>
          {eyebrow ? (
            <Paragraph
              margin={0}
              color="$mutedFg"
              fontSize={11}
              textTransform="uppercase"
              letterSpacing={0.6}
            >
              {eyebrow}
            </Paragraph>
          ) : null}
          <H1 margin={0} fontSize={24} lineHeight={30} fontWeight="650" color="$color">
            {title}
          </H1>
          {description ? (
            <Paragraph margin={0} color="$mutedFg" fontSize={13} maxWidth={680}>
              {description}
            </Paragraph>
          ) : null}
        </YStack>
        {actions ? <PageActions>{actions}</PageActions> : null}
      </XStack>
      {children}
    </YStack>
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  return (
    <XStack alignItems="center" justifyContent="flex-end" gap={8} flexWrap="wrap">
      {children}
    </XStack>
  );
}

export function MobileNav({ items }: { items: readonly AppFrameNavItem[] }) {
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;

  return (
    <XStack
      display="none"
      className="orrn-mobile-nav"
      alignItems="stretch"
      justifyContent="flex-start"
      gap={4}
      paddingHorizontal={8}
      paddingTop={8}
      paddingBottom={10}
      borderTopWidth={1}
      borderTopColor="$borderColor"
      backgroundColor="$backgroundStrong"
      overflowX="auto"
      flexShrink={0}
      zIndex={20}
    >
      {visible.map((item) => {
        const content = (
          <YStack
            key={item.key}
            alignItems="center"
            justifyContent="center"
            gap={2}
            minWidth={52}
            paddingHorizontal={6}
            paddingVertical={6}
            borderRadius={8}
            backgroundColor={item.active ? "$backgroundHover" : "transparent"}
            onPress={item.onPress}
            cursor={item.onPress ? "pointer" : undefined}
          >
            {item.icon ? <Text color={item.active ? "$primary" : "$mutedFg"}>{item.icon}</Text> : null}
            <Text
              fontSize={10}
              fontWeight={item.active ? "600" : "500"}
              color={item.active ? "$color" : "$mutedFg"}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </YStack>
        );
        if (!item.href) return content;
        return (
          <a key={item.key} href={item.href} className="no-underline">
            {content}
          </a>
        );
      })}
    </XStack>
  );
}

export function ActionMenu({ children }: { children: ReactNode }) {
  return (
    <XStack alignItems="center" gap={8} flexWrap="wrap">
      {children}
    </XStack>
  );
}

export function ConfirmAction({
  label,
  message,
  onConfirm,
  variant = "destructive",
  disabled,
}: {
  label: ReactNode;
  message: string;
  onConfirm: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  disabled?: boolean;
}) {
  return (
    <Button
      variant={variant}
      disabled={disabled}
      onPress={() => {
        if (typeof window === "undefined" || window.confirm(message)) {
          onConfirm();
        }
      }}
    >
      {label}
    </Button>
  );
}
