import type { ProcessKind } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";

import { OnNowChips } from "./line-view";
import { RegisterView } from "./register-view";
import { StartForm } from "./start-form";
import { Section } from "./ui";

/**
 * `/drawbench` and `/fabrication`: the steps of that kind, newest first, and a start form for people who may run them
 * (`process.run`). A step opens on `/jobwork/$id`, which holds the receive sheet for every kind.
 */
export function KindScreen({ kind }: { kind: Extract<ProcessKind, "draw" | "fabricate"> }) {
  const { t } = useT();
  const [starting, setStarting] = useState(false);
  return (
    <>
      <PageHeader
        title={t(`jw.kind.${kind}`)}
        subtitle={t(kind === "draw" ? "jw.draw.subtitle" : "jw.fabricate.subtitle")}
        actions={
          <Can do="process.run">
            <Button onClick={() => setStarting((s) => !s)} aria-expanded={starting} data-testid="start-step">
              <Plus aria-hidden="true" className="size-4" />
              {t("jw.action.startStep")}
            </Button>
          </Can>
        }
      />
      <OnNowChips kind={kind} />
      {starting ? (
        <Can do="process.run">
          <Section id={`start-${kind}`} title={t("jw.start.title", { kind: t(`jw.kind.${kind}`) })}>
            <StartForm kind={kind} onCancel={() => setStarting(false)} />
          </Section>
        </Can>
      ) : null}
      <RegisterView fixedKind={kind} empty={null} />
    </>
  );
}

export const DrawbenchScreen = () => <KindScreen kind="draw" />;
export const FabricationScreen = () => <KindScreen kind="fabricate" />;
