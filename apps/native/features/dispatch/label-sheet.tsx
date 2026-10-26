import { useT } from "@orrn/i18n";
import { useEffect, useState } from "react";
import { Text } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";

/** Labels a whole group of bundles for the packing list (the server stores it per bundle, upper case, 32 letters at most). */
export function LabelSheet({
  visible,
  initial,
  loading,
  error,
  onSave,
  onClose,
}: {
  visible: boolean;
  /** The current label, "" for none. */
  initial: string;
  loading: boolean;
  error: string | null;
  onSave: (label: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);

  return (
    <Sheet visible={visible} onClose={loading ? () => undefined : onClose} title={t("dispatch.build.groupLabel")}>
      <Field
        label={t("dispatch.build.groupLabel")}
        hint={t("native.dispatch.groupLabelHint")}
        value={text}
        onChangeText={setText}
        maxLength={32}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" className="font-sans-medium text-[15px] leading-6 text-destructive">
          {error}
        </Text>
      ) : null}
      <Button size="lg" label={t("common.save")} loading={loading} loadingLabel={t("common.saving")} onPress={() => onSave(text.trim() || null)} />
      {initial ? <Button variant="secondary" label={t("native.dispatch.clearLabel")} disabled={loading} onPress={() => onSave(null)} /> : null}
    </Sheet>
  );
}
