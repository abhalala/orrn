import type { MessageKey } from "@orrn/i18n";
import type { ReactNode } from "react";

import { CompanyTab } from "./company-tab";
import { DataTab } from "./data-tab";
import { PrintingTab } from "./printing-tab";
import { TeamTab } from "./team-tab";

/**
 * The sections of /settings, in tab order. Later work adds a row here (bought
 * modules and switches, standards, shifts) and a
 * component file next to this one; the route and the tab strip do not change.
 */
export type SettingsSection = {
  id: string;
  labelKey: MessageKey;
  render(): ReactNode;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "company", labelKey: "settings.tabs.company", render: () => <CompanyTab /> },
  { id: "team", labelKey: "settings.tabs.team", render: () => <TeamTab /> },
  { id: "printing", labelKey: "settings.tabs.printing", render: () => <PrintingTab /> },
  { id: "data", labelKey: "settings.tabs.data", render: () => <DataTab /> },
];

export const DEFAULT_SECTION = "company";

/** `?tab=` value to a known section id; anything else is the first section. */
export function parseSectionId(value: unknown, sections: readonly { id: string }[] = SETTINGS_SECTIONS): string {
  return sections.find((s) => s.id === value)?.id ?? sections[0]?.id ?? DEFAULT_SECTION;
}
