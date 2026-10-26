import { useT } from "@orrn/i18n";

/** Visible disclosure for the illustrative packing list, which is aria-hidden. */
export function DemoLabel() {
  const { t } = useT();
  return <span className="marketing-demo-label">{t("common.demoData")}</span>;
}
