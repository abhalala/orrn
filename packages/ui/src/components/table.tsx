import type { ReactNode } from "react";

import { Stack, Text, XStack, YStack } from "@orrn/ui/lib/tg";

/**
 * Plain primitives for hand-rolled table layouts where DataTable is too
 * structured. Render as Tamagui Stacks so they work on web + native.
 */

type StackBag = Record<string, any> & { children?: ReactNode };

export function Table({ children, ...rest }: StackBag) {
  return (
    <YStack
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={12}
      overflow="hidden"
      backgroundColor="$backgroundStrong"
      {...rest}
    >
      {children}
    </YStack>
  );
}

export function TableHeader({ children, ...rest }: StackBag) {
  return (
    <XStack
      backgroundColor="$muted"
      paddingHorizontal={12}
      paddingVertical={10}
      borderBottomWidth={1}
      borderBottomColor="$borderColor"
      gap={8}
      {...rest}
    >
      {children}
    </XStack>
  );
}

export function TableBody({ children, ...rest }: StackBag) {
  return <YStack {...rest}>{children}</YStack>;
}

export function TableRow({ children, ...rest }: StackBag) {
  return (
    <XStack
      paddingHorizontal={12}
      paddingVertical={12}
      borderBottomWidth={1}
      borderBottomColor="$borderColor"
      gap={8}
      hoverStyle={{ backgroundColor: "$backgroundHover" }}
      {...rest}
    >
      {children}
    </XStack>
  );
}

export function TableHead({
  children,
  flex = 1,
  align = "left",
  ...rest
}: StackBag & { flex?: number; align?: "left" | "right" | "center" }) {
  return (
    <Stack
      flex={flex}
      alignItems={align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start"}
      {...rest}
    >
      <Text fontSize={11} fontWeight="600" color="$mutedFg" textTransform="uppercase">
        {children}
      </Text>
    </Stack>
  );
}

export function TableCell({
  children,
  flex = 1,
  align = "left",
  ...rest
}: StackBag & { flex?: number; align?: "left" | "right" | "center" }) {
  return (
    <Stack
      flex={flex}
      alignItems={align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start"}
      justifyContent="center"
      {...rest}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <Text fontSize={13} color="$color">
          {children}
        </Text>
      ) : (
        children
      )}
    </Stack>
  );
}
