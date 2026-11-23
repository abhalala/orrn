import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";

import { DevicesTab } from "./devices-tab";
import { useDevicesModuleOn } from "./hooks";
import { ImportTab } from "./import-tab";
import { LabTab } from "./lab-tab";
import { ReadingsTab } from "./readings-tab";
import { DEVICE_TABS, type DevicesSearch, type DeviceTab } from "./search";
import { SettingsTab } from "./settings-tab";
import { WeighTab } from "./weigh-tab";

/**
 * `/devices` (XE parity lane DEVICES): the plant's weighbridge, scanner and tensile tester connections. Six tabs:
 * the devices and their health, what they sent, weights that differ from the bridge, the lab inbox, file import and
 * the settings. Every number on it comes from the server.
 */
export function DevicesScreen({ search, onSearch }: { search: DevicesSearch; onSearch(next: DevicesSearch): void }) {
  const { t } = useT();
  const moduleOn = useDevicesModuleOn();
  const tab: DeviceTab = search.tab ?? "devices";
  const header = <PageHeader title={t("dev3.title")} subtitle={t("dev3.subtitle")} back={{ to: "/today", label: t("nav.today") }} />;
  if (!moduleOn) {
    return (
      <>
        {header}
        <p data-testid="dev3-module-off" className="m-0 rounded-card border border-border bg-card px-4 py-3 text-[15px]">
          {t("dev3.moduleOff")}
        </p>
      </>
    );
  }
  return (
    <>
      {header}
      <Tabs
        label={t("dev3.title")}
        items={DEVICE_TABS.map((id) => ({ id, label: t(`dev3.tabs.${id}`) }))}
        value={tab}
        onValueChange={(next) => onSearch(next === "devices" ? {} : { tab: next as DeviceTab })}
      >
        <div className="flex min-w-0 flex-col gap-6 pt-4" data-testid={`dev3-tab-${tab}`}>
          {tab === "devices" ? <DevicesTab /> : null}
          {tab === "readings" ? <ReadingsTab kind={search.kind} onKind={(kind) => onSearch({ tab: "readings", ...(kind ? { kind } : {}) })} /> : null}
          {tab === "weigh" ? <WeighTab /> : null}
          {tab === "lab" ? <LabTab /> : null}
          {tab === "import" ? <ImportTab /> : null}
          {tab === "settings" ? <SettingsTab /> : null}
        </div>
      </Tabs>
    </>
  );
}
