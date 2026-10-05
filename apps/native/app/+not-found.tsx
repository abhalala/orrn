import { useT } from "@orrn/i18n";
import { useRouter } from "expo-router";

import { MessageScreen } from "@/components/message-screen";
import { Button } from "@/components/ui/button";

/** Unknown deep link. One way out: Today (the gate sends signed-out people to sign-in). */
export default function NotFoundScreen() {
  const { t } = useT();
  const router = useRouter();
  return (
    <MessageScreen title={t("errors.pageNotFound")}>
      <Button size="lg" label={t("errors.goToday")} onPress={() => router.replace("/")} />
    </MessageScreen>
  );
}
