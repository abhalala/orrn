import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";

/** A quality check's verdict, in the quality screen's own words. */
export function ResultChip({ result }: { result: string }) {
  const { t } = useT();
  const tone = result === "pass" ? "green" : result === "unchecked" ? "neutral" : "red";
  return (
    <Chip tone={tone} truncate={false} data-result={result}>
      {result === "pass" ? t("qa.result.pass") : result === "unchecked" ? t("qa.result.unchecked") : t("qa.result.fail")}
    </Chip>
  );
}
