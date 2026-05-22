import type { ReactNode } from "react";

import { Dialog as TgDialog, H4, Paragraph, XStack, YStack } from "@orrn/ui/lib/tg";

import { Button } from "./button";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  maxWidth?: number;
};

/**
 * Cross-platform modal dialog using Tamagui Dialog primitives.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  maxWidth = 480,
}: DialogProps) {
  return (
    <TgDialog modal open={open} onOpenChange={onOpenChange}>
      <TgDialog.Portal>
        <TgDialog.Overlay
          key="overlay"
          backgroundColor="rgba(15, 23, 42, 0.65)"
          animation="quick"
          opacity={1}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <TgDialog.Content
          key="content"
          backgroundColor="$backgroundStrong"
          borderRadius={12}
          padding={20}
          gap={16}
          maxWidth={maxWidth}
          width="90%"
          borderWidth={1}
          borderColor="$borderColor"
          animation="quick"
          enterStyle={{ opacity: 0, scale: 0.95 }}
          exitStyle={{ opacity: 0, scale: 0.95 }}
        >
          {title || description ? (
            <YStack gap={4}>
              {title ? (
                <TgDialog.Title asChild>
                  <H4 fontSize={16} fontWeight="600" margin={0}>
                    {title}
                  </H4>
                </TgDialog.Title>
              ) : null}
              {description ? (
                <TgDialog.Description asChild>
                  <Paragraph fontSize={13} color="$mutedFg" margin={0}>
                    {description}
                  </Paragraph>
                </TgDialog.Description>
              ) : null}
            </YStack>
          ) : null}

          {children}

          {actions ? (
            <XStack gap={8} justifyContent="flex-end">
              {actions}
            </XStack>
          ) : null}
        </TgDialog.Content>
      </TgDialog.Portal>
    </TgDialog>
  );
}

/** Convenience cancel button that closes the dialog. */
export function DialogCloseButton({
  onPress,
  children = "Cancel",
}: {
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <Button variant="outline" onPress={onPress}>
      {children}
    </Button>
  );
}
