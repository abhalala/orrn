import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const plugin = require("../plugins/with-ios-scene-lifecycle.js") as {
  addSceneDelegate(src: string): string;
  addSceneManifest(plist: Record<string, unknown>): Record<string, unknown>;
};

const TEMPLATE = readFileSync(join(import.meta.dir, "fixtures", "AppDelegate.expo55.swift"), "utf8");

/**
 * Apps built with the iOS 27 SDK (Xcode 27, the only toolchain on the build
 * Mac) must use the UIScene life cycle or UIKit refuses to launch them
 * ("UIScene life cycle is required for apps built with this SDK"). Expo 55's
 * template still creates its window in the AppDelegate, so the config plugin
 * moves that into a SceneDelegate on every prebuild.
 */
describe("iOS scene life cycle plugin", () => {
  test("app.json runs it", () => {
    const app = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8"));
    expect(app.expo.plugins).toContain("./plugins/with-ios-scene-lifecycle");
  });

  test("the AppDelegate no longer creates a window; a SceneDelegate starts React Native", () => {
    const out = plugin.addSceneDelegate(TEMPLATE);
    expect(out).not.toContain("UIWindow(frame: UIScreen.main.bounds)");
    expect(out).toContain("class SceneDelegate: UIResponder, UIWindowSceneDelegate");
    expect(out).toContain("UIWindow(windowScene: windowScene)");
    expect(out).toMatch(/factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)/);
    // Still a factory set up at launch, before any scene connects.
    expect(out).toContain("reactNativeFactory = factory");
  });

  test("links keep working: cold-start URL becomes the initial URL, later ones reach the app delegate", () => {
    const out = plugin.addSceneDelegate(TEMPLATE);
    expect(out).toContain("launchOptions[.url] = url");
    // expo-router reads the initial URL from expo-linking, which only learns it
    // through the app delegate's open-URL hook; a cold start must call it too.
    const willConnect = out.slice(out.indexOf("willConnectTo"), out.indexOf("openURLContexts"));
    expect(willConnect).toContain("app.application(UIApplication.shared, open: url, options: [:])");
    expect(willConnect).toContain("connectionOptions.userActivities.first");
    expect(out).toContain("openURLContexts");
    expect(out).toContain("app.application(UIApplication.shared, open: url, options: [:])");
    expect(out).toContain("continue userActivity: NSUserActivity");
  });

  test("running twice changes nothing more", () => {
    const once = plugin.addSceneDelegate(TEMPLATE);
    expect(plugin.addSceneDelegate(once)).toBe(once);
  });

  test("an unknown template fails the prebuild loudly instead of shipping an app that cannot launch", () => {
    expect(() => plugin.addSceneDelegate("class AppDelegate {}")).toThrow(/scene/i);
  });

  test("Info.plist declares the scene and keeps existing keys", () => {
    const plist = plugin.addSceneManifest({ CFBundleName: "orrn" });
    expect(plist.CFBundleName).toBe("orrn");
    expect(plist.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    });
  });
});
