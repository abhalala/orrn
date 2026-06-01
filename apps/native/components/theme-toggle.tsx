import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { cssInterop } from "nativewind";
import { Platform, Pressable } from "react-native";
import Animated, { FadeOut, ZoomIn } from "react-native-reanimated";

import { useAppTheme } from "@/contexts/app-theme-context";

const StyledIonicons = cssInterop(Ionicons, {
  className: { target: "style", nativeStyleToProp: { color: true } },
});

export function ThemeToggle() {
  const { toggleTheme, isLight } = useAppTheme();

  return (
    <Pressable
      testID="theme-toggle"
      accessibilityLabel="Toggle theme"
      onPress={() => {
        if (Platform.OS === "ios") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        toggleTheme();
      }}
      className="px-2.5"
    >
      {isLight ? (
        <Animated.View key="moon" entering={ZoomIn} exiting={FadeOut}>
          <StyledIonicons name="moon" size={20} className="text-foreground" />
        </Animated.View>
      ) : (
        <Animated.View key="sun" entering={ZoomIn} exiting={FadeOut}>
          <StyledIonicons name="sunny" size={20} className="text-foreground" />
        </Animated.View>
      )}
    </Pressable>
  );
}
