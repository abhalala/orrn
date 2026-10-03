import { cssInterop } from "nativewind";
import { Pressable } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";

/**
 * NativeWind only turns `className` into styles for components it knows
 * (React Native core, SafeAreaView). Reanimated and keyboard-controller
 * components are compiled without NativeWind's JSX, so their `className` was
 * silently dropped. Register them once; imported first by app/_layout.tsx.
 */
cssInterop(Animated.View, { className: "style" });
cssInterop(Animated.Text, { className: "style" });
cssInterop(Animated.ScrollView, { className: "style", contentContainerClassName: "contentContainerStyle" });
cssInterop(KeyboardAwareScrollView, { className: "style", contentContainerClassName: "contentContainerStyle" });

/** Pressable with Reanimated styles (press scale) that still takes `className`. */
export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
cssInterop(AnimatedPressable, { className: "style" });
