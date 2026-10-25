import { useT, type MessageKey } from "@orrn/i18n";
import { View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";

import type { AttentionReason, CopyStatus } from "./attention";
import { pctTenthText, statusTone, toneToChip } from "./copy-model";
import type { CopyRow } from "./use-attention";

export const REASON_KEY: Record<AttentionReason, MessageKey> = {
  above_band: "native.dies.reason.above_band",
  at_nitriding: "native.dies.reason.at_nitriding",
  at_maker: "native.dies.reason.at_maker",
  on_trial: "native.dies.reason.on_trial",
  open_issue: "native.dies.reason.open_issue",
  stale_reading: "native.dies.reason.stale_reading",
  never_read: "native.dies.reason.never_read",
};

const STATUS_KEY: Record<CopyStatus, MessageKey> = {
  available: "dieRoom.status.available",
  in_use: "dieRoom.status.in_use",
  at_nitriding: "dieRoom.status.at_nitriding",
  at_maker: "dieRoom.status.at_maker",
  on_trial: "dieRoom.status.on_trial",
  retired: "dieRoom.status.retired",
};

export function statusKey(status: CopyStatus): MessageKey {
  return STATUS_KEY[status];
}

/**
 * One copy in a list: its code, the section it belongs to, why it is here and its drift against
 * its own band (the server's tone and percent). Tapping opens the card.
 */
export function CopyListRow({ copy, reasons, onPress }: { copy: CopyRow; reasons?: readonly AttentionReason[]; onPress: () => void }) {
  const { t } = useT();
  const status = copy.status as CopyStatus;
  const why = reasons && reasons.length > 0 ? reasons.map((r) => t(REASON_KEY[r])).join(", ") : t(STATUS_KEY[status]);
  const band = copy.bandText ? `${copy.bandText} ${t("units.kgPer12ft")}` : null;
  const drift =
    copy.latestMilli != null && copy.percentTenths != null ? (
      <Chip tone={toneToChip(copy.tone)} label={pctTenthText(copy.percentTenths)} />
    ) : (
      <Chip tone="neutral" label={t("dieRoom.drift.none")} />
    );
  return (
    <ListRow
      title={copy.code}
      subtitle={[why, band].filter(Boolean).join(", ")}
      trailing={
        <View className="items-end gap-1">
          <Chip tone={statusTone(status)} label={t(STATUS_KEY[status])} />
          {drift}
        </View>
      }
      onPress={onPress}
    />
  );
}
