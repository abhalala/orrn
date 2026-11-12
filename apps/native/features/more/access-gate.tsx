import { useT } from "@orrn/i18n";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";

import type { MoreAccess } from "./access";

export function MoreAccessGate({ access, children }: { access: MoreAccess; children: ReactNode }) {
  const { t } = useT();
  if (access === "not_allowed") return <Screen><EmptyState title={t("foundry.common.notAllowed")} /></Screen>;
  return <>{children}</>;
}
