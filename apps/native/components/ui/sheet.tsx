import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/**
 * Bottom sheet for pickers and confirmations (die picker, dispatch picker,
 * void reason). A native Modal: it traps focus for screen readers, Android Back
 * closes it, and the keyboard pushes it up. The scrim and the close button both close it.
 */
export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={onClose} className="absolute inset-0 bg-black/50" />
        <View accessibilityViewIsModal className="max-h-[88%] rounded-t-hero bg-surface px-4 pb-8 pt-3">
          <View className="mb-2 flex-row items-center justify-between gap-3">
            <Text accessibilityRole="header" className="min-w-0 flex-1 font-display-bold text-xl text-ink">
              {title}
            </Text>
            <PressableScale accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={onClose} hitSlop={4} className="h-11 w-11 items-center justify-center rounded-full">
              <Feather name="x" size={22} color={ink} />
            </PressableScale>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 pb-2">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
