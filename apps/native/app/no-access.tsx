import { useT } from "@orrn/i18n";
import { useState } from "react";
import { Text, View } from "react-native";

import { MessageScreen } from "@/components/message-screen";
import { Button } from "@/components/ui/button";
import { noAccessReason } from "@/lib/gate";
import { signOut } from "@/lib/sign-out";
import { useMe } from "@/utils/me";

/**
 * Signed in, but not able to use the plant app yet: no company, a platform
 * staff account (Godseye is web only), or a temporary password to replace.
 * "Check again" refetches `auth.me`; the gate moves on by itself once fixed.
 */
export default function NoAccessScreen() {
  const { t } = useT();
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const reason = noAccessReason(me.data) ?? "no-company";
  const email = me.data?.user.email ?? "";

  const title =
    reason === "set-password" ? t("native.setPasswordTitle") : reason === "staff" ? t("native.staffTitle") : t("auth.noAccess.title");
  const body =
    reason === "set-password" ? (
      t("native.setPasswordBody")
    ) : reason === "staff" ? (
      t("native.staffBody")
    ) : (
      <View className="gap-2">
        <Text className="font-sans text-base leading-6 text-ink-muted">{t("auth.noAccess.body", { email })}</Text>
        <Text className="font-sans text-base leading-6 text-ink-muted">{t("auth.noAccess.ask")}</Text>
      </View>
    );

  return (
    <MessageScreen title={title} body={body}>
      {reason !== "staff" ? (
        <Button size="lg" label={t("native.checkAgain")} loading={me.isFetching} onPress={() => void me.refetch()} />
      ) : null}
      <Button
        size="lg"
        variant={reason === "staff" ? "primary" : "secondary"}
        label={t("auth.noAccess.switchAccount")}
        loading={signingOut}
        loadingLabel={t("native.signingOut")}
        onPress={async () => {
          setSigningOut(true);
          await signOut();
        }}
      />
    </MessageScreen>
  );
}
