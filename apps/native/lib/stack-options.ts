/**
 * Themed options for every native Stack, as a pure function of the platform
 * and two theme colours (lib/screen-options.ts passes the live values), so
 * bun can test it.
 */

/** Font families registered in lib/fonts.ts. */
const DISPLAY = "BricolageGrotesque_700Bold";
const DISPLAY_LARGE = "BricolageGrotesque_800ExtraBold";

export function stackOptions({
  os,
  canvas,
  ink,
  largeTitle = false,
}: {
  os: string;
  canvas: string;
  ink: string;
  largeTitle?: boolean;
}) {
  return {
    // iOS: no header background. With an opaque one (react-native-screens 4.23,
    // iOS 27 SDK) the large title is laid out but never drawn; the system bar is
    // clear over the canvas at the top and glass once the content scrolls under
    // it. Android has no large title and needs the canvas colour.
    ...(os === "ios" ? {} : { headerStyle: { backgroundColor: canvas } }),
    headerTintColor: ink,
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: DISPLAY, fontSize: 18, color: ink },
    headerLargeTitle: largeTitle,
    headerLargeTitleShadowVisible: false,
    headerLargeTitleStyle: { fontFamily: DISPLAY_LARGE, color: ink },
    headerBackButtonDisplayMode: "minimal" as const,
    contentStyle: { backgroundColor: canvas },
  };
}
