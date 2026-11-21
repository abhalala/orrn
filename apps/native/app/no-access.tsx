import { useT } from "@orrn/i18n";
import { useState } from "react";
import { Text, View } from "react-native";

import { MessageScreen } from "@/components/message-screen";
import { Button } from "@/components/ui/button";
import { noAccessReason } from "@/lib/gate";
import { plantChoice } from "@/lib/plant-choice";
import { signOut } from "@/lib/sign-out";
import { useMe } from "@/utils/me";

/**
 * Signed in, but not able to use the plant app yet: no company, a platform
 * staff account (Godseye is web only), a temporary password to replace, or a
 * plant that needs steps the phone does not have (its secure sign-in policy,
 * or an owner's or admin's company setup; plan 2026-11-18, Task 9): "finish on
 * the web". "Check again" refetches `auth.me`; the gate moves on by itself once
 * fixed. A person in several plants may choose another one instead.
 */
export default function NoAccessScreen() {
  const { t } = useT();
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const reason = noAccessReason(me.data) ?? "no-company";
  const email = me.data?.user.email ?? "";
  const company = me.data?.company?.name ?? "";
  const onWeb = reason === "secure-on-web" || reason === "finish-on-web";
  const otherPlants = onWeb && (me.data?.memberships?.length ?? 0) > 1;

  const title =
    reason === "set-password"
      ? t("native.setPasswordTitle")
      : reason === "staff"
        ? t("native.staffTitle")
        : onWeb
          ? t("native.finishOnWebTitle")
          : t("auth.noAccess.title");
  const body =
    reason === "set-password" ? (
      t("native.setPasswordBody")
    ) : reason === "secure-on-web" ? (
      t("native.secureOnWebBody", { company })
    ) : reason === "finish-on-web" ? (
      t("native.finishOnWebBody", { company })
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
      {otherPlants ? (
        <Button size="lg" variant="secondary" label={t("auth.choosePlant.another")} onPress={() => plantChoice.set(true)} />
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
