// @ts-check
/**
 * Config plugin: move the iOS app to the UIScene life cycle.
 *
 * Apps linked against the iOS 27 SDK (Xcode 27) must adopt UIScene, or UIKit
 * refuses to launch them ("UIScene life cycle is required for apps built with
 * this SDK"). Expo SDK 55's template still creates its window in the
 * AppDelegate, so on every prebuild this plugin:
 *   - stops the AppDelegate creating the window (the React Native factory is
 *     still set up at launch),
 *   - adds a SceneDelegate that creates the window for the scene and starts
 *     React Native in it, passing a cold-start link as the initial URL and
 *     forwarding later links and user activities to the AppDelegate,
 *   - declares that SceneDelegate in Info.plist.
 * Remove it once the Expo template adopts UIScene itself (the prebuild fails
 * loudly if the template no longer matches). Tests: __tests__/scene-plugin.test.ts.
 */
const { createRunOncePlugin, withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const MARKER = "class SceneDelegate: UIResponder, UIWindowSceneDelegate";

const WINDOW_IN_APP_DELEGATE =
  /\n([ \t]*)window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)\n/;

const SCENE_DELEGATE = `
// Added by plugins/with-ios-scene-lifecycle.js: apps built with the iOS 27 SDK
// must use the UIScene life cycle, so the window is created here, per scene.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate,
          let factory = app.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    app.window = window

    // A link that launched the app becomes the initial URL: React Native's
    // Linking reads launchOptions, and expo-linking (what expo-router asks)
    // only learns it through the app delegate's open-URL hook, which UIKit no
    // longer calls on a scene cold start.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
      _ = app.application(UIApplication.shared, open: url, options: [:])
    } else if let activity = connectionOptions.userActivities.first {
      _ = app.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
  }

  // Links that arrive while the app is running.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url,
          let app = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = app.application(UIApplication.shared, open: url, options: [:])
  }

  // Universal links and handoff while the app is running.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = app.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

/**
 * @param {string} src AppDelegate.swift from the Expo template
 * @returns {string}
 */
function addSceneDelegate(src) {
  if (src.includes(MARKER)) return src;
  if (!WINDOW_IN_APP_DELEGATE.test(src)) {
    throw new Error(
      "with-ios-scene-lifecycle: the AppDelegate template changed and no longer creates the window in " +
        "application(_:didFinishLaunchingWithOptions:). Check whether Expo now adopts the UIScene life cycle " +
        "itself; if so, remove this plugin from app.json, otherwise update the plugin.",
    );
  }
  const withoutWindow = src.replace(
    WINDOW_IN_APP_DELEGATE,
    (_match, indent) =>
      `\n${indent}// The window is created per scene in SceneDelegate (plugins/with-ios-scene-lifecycle.js).\n`,
  );
  return `${withoutWindow.trimEnd()}\n${SCENE_DELEGATE}`;
}

/**
 * @param {Record<string, unknown>} plist
 * @returns {Record<string, unknown>}
 */
function addSceneManifest(plist) {
  return {
    ...plist,
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    },
  };
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withIosSceneLifecycle = (config) => {
  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error("with-ios-scene-lifecycle: expected a Swift AppDelegate (Expo SDK 55 template).");
    }
    cfg.modResults.contents = addSceneDelegate(cfg.modResults.contents);
    return cfg;
  });
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults = /** @type {any} */ (addSceneManifest(cfg.modResults));
    return cfg;
  });
  return config;
};

module.exports = createRunOncePlugin(withIosSceneLifecycle, "with-ios-scene-lifecycle", "1.0.0");
module.exports.addSceneDelegate = addSceneDelegate;
module.exports.addSceneManifest = addSceneManifest;
