import type { ReactNode } from "react";

import { Sheet as TgSheet, YStack } from "@orrn/ui/lib/tg";

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapPoints?: number[];
  children: ReactNode;
};

/**
 * Bottom sheet primitive (Tamagui Sheet).
 */
export function Sheet({ open, onOpenChange, snapPoints = [80, 50], children }: SheetProps) {
  return (
    <TgSheet
      modal
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={snapPoints}
      dismissOnSnapToBottom
    >
      <TgSheet.Overlay backgroundColor="rgba(15, 23, 42, 0.5)" />
      <TgSheet.Handle />
      <TgSheet.Frame backgroundColor="$backgroundStrong" padding={20} gap={12}>
        <YStack gap={12}>{children}</YStack>
      </TgSheet.Frame>
    </TgSheet>
  );
}
