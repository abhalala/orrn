import { useT } from "@orrn/i18n";
import { Text } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** Words for the way out; defaults to "Cancel". */
  keepLabel?: string;
  danger?: boolean;
  loading?: boolean;
  /** What went wrong the last time, shown in the sheet so it is not hidden behind it. */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

/** A yes or no before something that cannot be taken back: what happens, then the two buttons. */
export function ConfirmSheet({ visible, title, body, confirmLabel, keepLabel, danger, loading, error, onConfirm, onClose }: ConfirmSheetProps) {
  const { t } = useT();
  return (
    <Sheet visible={visible} onClose={loading ? () => undefined : onClose} title={title}>
      <Text className="font-sans text-base leading-6 text-ink">{body}</Text>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="font-sans-medium text-[15px] leading-6 text-destructive">
          {error}
        </Text>
      ) : null}
      <Button size="lg" variant={danger ? "danger" : "primary"} label={confirmLabel} loading={loading} onPress={onConfirm} />
      <Button variant="secondary" label={keepLabel ?? t("common.cancel")} disabled={loading} onPress={onClose} />
    </Sheet>
  );
}
