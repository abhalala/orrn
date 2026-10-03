import { cssInterop } from "nativewind";
import { Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";

/**
 * NativeWind only turns `className` into styles for components it knows
 * (React Native core, SafeAreaView); on anything else `className` is silently
 * dropped. Register those components here; imported first by app/_layout.tsx.
 *
 * Two traps (both crashed the sign-in screen; __tests__/press.test.ts guards them):
 * - NativeWind's JSX transform also runs over libraries that ship source
 *   (keyboard-controller, Reanimated, screens), so registering Reanimated's
 *   OWN `Animated.View`/`Text`/`ScrollView` hijacks the library's internal
 *   copies, which carry `useAnimatedStyle` handles. Register our own
 *   `createAnimatedComponent(...)` twins below and import those instead.
 * - Never give a component with `className` a `useAnimatedStyle` handle:
 *   NativeWind's style merge reads every key, which throws in dev and drops
 *   the animation in release. Use plain styles, Reanimated CSS transitions
 *   (`pressStyle`) or layout animations (`entering`).
 */

/** Animated View with `className` (layout animations such as `entering`, CSS transitions). */
export const AnimatedView = Animated.createAnimatedComponent(View);
cssInterop(AnimatedView, { className: "style" });

/** Animated Text with `className`. */
export const AnimatedText = Animated.createAnimatedComponent(Text);
cssInterop(AnimatedText, { className: "style" });

/** Animated ScrollView with `className` and `contentContainerClassName`. */
export const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);
cssInterop(AnimatedScrollView, { className: "style", contentContainerClassName: "contentContainerStyle" });

/** Animated Pressable with `className`; screens use `PressableScale`, which is built on it. */
export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
cssInterop(AnimatedPressable, { className: "style" });

// Our screens render it directly; the library never renders itself, so this is safe.
cssInterop(KeyboardAwareScrollView, { className: "style", contentContainerClassName: "contentContainerStyle" });
