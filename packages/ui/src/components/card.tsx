import type { ReactNode } from "react";

import { Card as TgCard, H4, Paragraph, XStack, YStack } from "@orrn/ui/lib/tg";

/**
 * ORRN Card. Tamagui-based, cross-platform. The public API mirrors the
 * old shadcn card subcomponents (`CardHeader`, `CardTitle`, etc.) so screen
 * migration is mostly find-and-replace.
 */
export type CardProps = Record<string, any> & {
  size?: "sm" | "default";
  className?: string;
  children?: ReactNode;
};

export function Card({ size = "default", children, ...rest }: CardProps) {
  return (
    <TgCard
      bordered
      elevate={false}
      borderRadius={8}
      backgroundColor="$backgroundStrong"
      borderColor="$borderColor"
      padding={size === "sm" ? 12 : 16}
      gap={size === "sm" ? 8 : 12}
      alignItems="stretch"
      shadowColor="rgba(0,0,0,0.18)"
      shadowRadius={18}
      shadowOpacity={0.12}
      shadowOffset={{ width: 0, height: 12 }}
      {...rest}
    >
      {children}
    </TgCard>
  );
}

export function CardHeader({ children, ...rest }: { children?: ReactNode } & Record<string, any>) {
  return (
    <YStack gap={4} {...rest}>
      {children}
    </YStack>
  );
}

export function CardTitle({ children, ...rest }: { children?: ReactNode } & Record<string, any>) {
  return (
    <H4 fontSize={16} fontWeight="600" color="$color" margin={0} {...rest}>
      {children}
    </H4>
  );
}

export function CardDescription({ children, ...rest }: { children?: ReactNode } & Record<string, any>) {
  return (
    <Paragraph fontSize={12} color="$mutedFg" margin={0} {...rest}>
      {children}
    </Paragraph>
  );
}

export function CardAction({ children, ...rest }: { children?: ReactNode } & Record<string, any>) {
  return (
    <XStack alignItems="center" gap={8} marginLeft="auto" {...rest}>
      {children}
    </XStack>
  );
}

export function CardContent({ children, ...rest }: { children?: ReactNode } & Record<string, any>) {
  return (
    <YStack gap={8} {...rest}>
      {children}
    </YStack>
  );
}

export function CardFooter({ children, ...rest }: { children?: ReactNode } & Record<string, any>) {
  return (
    <XStack
      alignItems="center"
      paddingTop={12}
      borderTopWidth={1}
      borderTopColor="$borderColor"
      gap={8}
      {...rest}
    >
      {children}
    </XStack>
  );
}

export type CardSectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
} & Record<string, any>;

/** Convenience wrapper for the common "header row + content" pattern. */
export function CardSection({ title, description, actions, children, ...rest }: CardSectionProps) {
  return (
    <YStack gap={12} {...rest}>
      {(title || actions) && (
        <XStack alignItems="center" gap={12}>
          <YStack gap={2} flex={1}>
            {title ? (
              <H4 margin={0} fontSize={14} fontWeight="600">
                {title}
              </H4>
            ) : null}
            {description ? (
              <Paragraph fontSize={12} color="$mutedFg" margin={0}>
                {description}
              </Paragraph>
            ) : null}
          </YStack>
          {actions}
        </XStack>
      )}
      {children}
    </YStack>
  );
}
