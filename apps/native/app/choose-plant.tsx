import { useT, type MessageKey } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { MessageScreen } from "@/components/message-screen";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { plantChoice } from "@/lib/plant-choice";
import { signOut } from "@/lib/sign-out";
import { meQueryOptions, useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

/**
 * "Choose a plant" after a sign-in (plan 2026-11-18, Task 9; owner amendment items 4 and 6). Each plant
 * with the person's role and "Setup pending" when its onboarding is open for them. Picking calls
 * `company.switch` (the phone sends no `x-orrn-company`: the server's last choice is the active plant),
 * reads `auth.me` again (the tenant cache guard drops the old plant's queries when the company changes)
 * and only then clears the owed pick, so the gate moves straight to Today or, when the plant still needs
 * steps the phone does not have, to the "finish on the web" screen.
 */
export default function ChoosePlantScreen() {
  const { t } = useT();
  const me = useMe();
  const sw = useMutation(trpc.company.switch.mutationOptions());
  const [picking, setPicking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const plants = me.data?.memberships ?? [];

  async function pick(companyId: string) {
    if (picking) return;
    setFailed(false);
    setPicking(companyId);
    try {
      await sw.mutateAsync({ companyId });
      await queryClient.fetchQuery({ ...meQueryOptions(), staleTime: 0, retry: false });
      plantChoice.set(false);
    } catch {
      setFailed(true);
    } finally {
      setPicking(null);
    }
  }

  return (
    <MessageScreen
      title={t("auth.choosePlant.title")}
      body={
        <View className="gap-4">
          <Text className="font-sans text-base leading-6 text-ink-muted">{t("auth.choosePlant.body")}</Text>
          {failed ? (
            <Text accessibilityRole="alert" className="font-sans-semibold text-base leading-6 text-tone-red-ink">
              {t("auth.choosePlant.failed")}
            </Text>
          ) : null}
          <View className="gap-3" accessibilityRole="list">
            {plants.map((plant) => {
              const role = t(`roles.${plant.role}` as MessageKey);
              const pending = plant.setupPending === true;
              const busy = picking === plant.companyId;
              return (
                <ListRow
                  key={plant.companyId}
                  title={plant.name}
                  subtitle={busy ? t("auth.choosePlant.opening", { name: plant.name }) : role}
                  trailing={pending ? <Chip tone="amber" label={t("auth.choosePlant.setupPending")} /> : undefined}
                  accessibilityLabel={[plant.name, role, pending ? t("auth.choosePlant.setupPending") : null].filter(Boolean).join(", ")}
                  onPress={picking ? undefined : () => void pick(plant.companyId)}
                />
              );
            })}
          </View>
        </View>
      }
    >
      <Button
        size="lg"
        variant="secondary"
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
