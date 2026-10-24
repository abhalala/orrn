import { Button } from "@orrn/ui/components/button";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Link } from "@tanstack/react-router";

import type { FileRouteTypes } from "@/routeTree.gen";

import { chromeFor, type ChromeStrings, type PreviewLocale } from "./fixtures";
import { updatePlatformPreviewState, usePlatformPreviewState } from "./state";

export function useChrome(): ChromeStrings {
  const { locale } = usePlatformPreviewState();
  return chromeFor(locale);
}

const LOCALES: { value: PreviewLocale; label: string }[] = [
  { value: "en", label: "en" },
  { value: "hi", label: "hi" },
  { value: "gu", label: "gu" },
];

export function LanguageToggle() {
  const { locale } = usePlatformPreviewState();
  return (
    <SegmentedControl
      label="Language"
      value={locale}
      options={LOCALES}
      onChange={(next) => updatePlatformPreviewState({ locale: next })}
    />
  );
}

const SCREENS = [
  { id: "today", to: "/preview/platform", registered: true },
  { id: "settings", to: "/preview/platform/settings", registered: false },
  { id: "portal", to: "/preview/platform/portal", registered: false },
  { id: "devices", to: "/preview/platform/devices", registered: false },
] as const satisfies readonly {
  id: string;
  to: FileRouteTypes["to"];
  registered: boolean;
}[];

type ScreenId = (typeof SCREENS)[number]["id"];

export function PlatformLinks({ current }: { current: ScreenId }) {
  const chrome = useChrome();
  const label: Record<ScreenId, string> = {
    today: chrome.today,
    settings: chrome.settings,
    portal: "Party portal",
    devices: "Devices",
  };
  return (
    <nav aria-label="Platform preview" className="flex flex-wrap gap-2">
      {SCREENS.map((screen) =>
        screen.id === current ? (
          <Button key={screen.id} type="button" variant="primary" aria-current="page">
            {label[screen.id]}
          </Button>
        ) : (
          <Button key={screen.id} variant="secondary" asChild>
            <Link to={screen.to}>{label[screen.id]}</Link>
          </Button>
        ),
      )}
    </nav>
  );
}

export function ChromeStrip() {
  const chrome = useChrome();
  const words = [chrome.today, chrome.day, chrome.night, chrome.settings, chrome.dispatch, chrome.stock];
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {words.map((word) => (
        <li
          key={word}
          className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface-sunken px-3 text-[13px] font-semibold"
        >
          {word}
        </li>
      ))}
    </ul>
  );
}

/**
 * Demo-only control for the party portal: shows what a party sees if it asks
 * for a die outside its grants. Lives in the preview chrome bar, not inline
 * with product content. `EmptyState`'s own action clears it back off.
 */
export function DieAccessDemo() {
  const { hiddenDieProbe } = usePlatformPreviewState();
  if (hiddenDieProbe) return null;
  return (
    <Button type="button" variant="secondary" onClick={() => updatePlatformPreviewState({ hiddenDieProbe: true })}>
      Demo: ask for a die I can&apos;t see
    </Button>
  );
}
