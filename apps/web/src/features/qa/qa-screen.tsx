import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";

import { ChecksTab } from "./checks-tab";
import { HoldsTab } from "./holds-tab";
import { useQaModuleOn } from "./hooks";
import { InstrumentsTab } from "./instruments-tab";
import { ListsTab } from "./lists-tab";
import { QA_TABS, type QaSearch, type QaTab } from "./search";
import { SettingsTab } from "./settings-tab";
import { WaitingTab } from "./waiting-tab";

/**
 * `/qa` (XE parity lane QA): about seven checkpoints on documents the plant already has. One screen,
 * six tabs: what waits for a check, quality holds, the check registers (one list filtered by kind),
 * instruments, the lists behind them (tempers, plans, inspection points, alloy substitutes) and the
 * quality switches. Every number on it comes from the server.
 */
export function QaScreen({ search, onSearch }: { search: QaSearch; onSearch(next: QaSearch): void }) {
  const { t } = useT();
  const moduleOn = useQaModuleOn();
  const tab: QaTab = search.tab ?? "waiting";
  const header = <PageHeader title={t("qa.title")} subtitle={t("qa.subtitle")} back={{ to: "/today", label: t("nav.today") }} />;
  if (!moduleOn) {
    return (
      <>
        {header}
        <p data-testid="qa-module-off" className="m-0 rounded-card border border-border bg-card px-4 py-3 text-[15px]">
          {t("qa.moduleOff")}
        </p>
      </>
    );
  }
  return (
    <>
      {header}
      <Tabs
        label={t("qa.title")}
        items={QA_TABS.map((id) => ({ id, label: t(`qa.tabs.${id}`) }))}
        value={tab}
        onValueChange={(next) => onSearch(next === "waiting" ? {} : { tab: next as QaTab })}
      >
        <div className="flex min-w-0 flex-col gap-6 pt-4" data-testid={`qa-tab-${tab}`}>
          {tab === "waiting" ? <WaitingTab stage={search.stage ?? "incoming"} onStage={(stage) => onSearch({ stage })} /> : null}
          {tab === "holds" ? <HoldsTab log={Boolean(search.log)} onLog={(log) => onSearch({ tab: "holds", ...(log ? { log: true } : {}) })} /> : null}
          {tab === "checks" ? <ChecksTab kind={search.kind} stage={search.stage} runId={search.run} onSearch={(s) => onSearch({ tab: "checks", ...s })} /> : null}
          {tab === "instruments" ? <InstrumentsTab /> : null}
          {tab === "lists" ? <ListsTab list={search.list ?? "tempers"} onList={(list) => onSearch({ tab: "lists", list })} /> : null}
          {tab === "settings" ? <SettingsTab /> : null}
        </div>
      </Tabs>
    </>
  );
}
