import type { MessageKey } from "@orrn/i18n";
import type { Action } from "@orrn/server/lib/permissions";
import type { ReactNode } from "react";

import { AboutTab } from "./about-tab";
import { BackupTab } from "./backup-tab";
import { CompanyTab } from "./company-tab";
import { DataTab } from "./data-tab";
import { DevicesTab } from "./devices-tab";
import { ModulesTab } from "./modules-tab";
import { PrintingTab } from "./printing-tab";
import { ShiftsTab } from "./shifts-tab";
import { StandardsTab } from "./standards-tab";
import { SupportTab } from "./support-tab";
import { TeamTab } from "./team-tab";

/**
 * The sections of /settings, in tab order. A new section is a row here and a component file next
 * to this one; the route and the tab strip do not change. `requires` hides the tab from roles that
 * hold none of the actions (the tab's procedures would refuse them anyway); the server stays the
 * judge of every read and write.
 */
export type SettingsSection = {
  id: string;
  labelKey: MessageKey;
  requires?: readonly Action[];
  render(): ReactNode;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "company", labelKey: "settings.tabs.company", render: () => <CompanyTab /> },
  { id: "shifts", labelKey: "settings.tabs.shifts", render: () => <ShiftsTab /> },
  { id: "standards", labelKey: "settings.tabs.standards", render: () => <StandardsTab /> },
  { id: "modules", labelKey: "settings.tabs.modules", render: () => <ModulesTab /> },
  { id: "team", labelKey: "settings.tabs.team", render: () => <TeamTab /> },
  // Devices: `device.list` is users.manage. Backup: `backup.status` is settings.update.
  { id: "devices", labelKey: "settings.tabs.devices", requires: ["users.manage"], render: () => <DevicesTab /> },
  { id: "backup", labelKey: "settings.tabs.backup", requires: ["settings.update"], render: () => <BackupTab /> },
  { id: "support", labelKey: "settings.tabs.support", requires: ["support.request"], render: () => <SupportTab /> },
  { id: "about", labelKey: "settings.tabs.about", render: () => <AboutTab /> },
  { id: "printing", labelKey: "settings.tabs.printing", render: () => <PrintingTab /> },
  { id: "data", labelKey: "settings.tabs.data", render: () => <DataTab /> },
];

export const DEFAULT_SECTION = "company";

/** `?tab=` value to a known section id; anything else is the first section. */
export function parseSectionId(value: unknown, sections: readonly { id: string }[] = SETTINGS_SECTIONS): string {
  return sections.find((s) => s.id === value)?.id ?? sections[0]?.id ?? DEFAULT_SECTION;
}
