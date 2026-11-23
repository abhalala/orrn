import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useState } from "react";

import { canAny, useMe } from "@/shared/lib/me";

import { SendForm } from "./send-form";
import { StartForm } from "./start-form";

/**
 * `/jobwork/new`: a new job-work challan to a vendor (`jobwork.send`) or an in-house step on the finishing line
 * (`process.run`). A person who holds only one of the two sees only that form; a person who holds both picks.
 */
export function NewScreen() {
  const { t } = useT();
  const { data: me } = useMe();
  const mayVendor = canAny(me, ["jobwork.send"]);
  const mayLine = canAny(me, ["process.run"]);
  const [mode, setMode] = useState<"vendor" | "line">(mayVendor ? "vendor" : "line");
  const back = { to: "/jobwork", label: t("jw.title") };

  if (!mayVendor && !mayLine) {
    return (
      <>
        <PageHeader title={t("jw.new.title")} back={back} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("jw.noAccess")} body={t("jw.noAccessBody")} />
        </div>
      </>
    );
  }
  const active = mayVendor && mayLine ? mode : mayVendor ? "vendor" : "line";
  return (
    <>
      <PageHeader title={active === "vendor" ? t("jw.new.title") : t("jw.new.lineTitle")} subtitle={active === "vendor" ? t("jw.new.subtitle") : t("jw.new.lineSubtitle")} back={back} />
      {mayVendor && mayLine ? (
        <SegmentedControl
          value={mode}
          onChange={setMode}
          label={t("jw.new.mode")}
          options={[
            { value: "vendor", label: t("jw.new.toVendor") },
            { value: "line", label: t("jw.new.onLine") },
          ]}
        />
      ) : null}
      {active === "vendor" ? <SendForm /> : <StartForm kind="finish" />}
    </>
  );
}
