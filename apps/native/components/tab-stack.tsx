import { useT, type MessageKey } from "@orrn/i18n";
import { Stack } from "expo-router";

import { AccountButton } from "@/components/account-button";
import { useStackOptions } from "@/lib/screen-options";

/**
 * The Stack inside one tab (Today, Pack, Stock, Dispatch). The root screen
 * gets the iOS large title and the account avatar; detail screens pushed on
 * top (e.g. `pack/[id]`) get a back button and set their own title.
 */
export function TabStack({ titleKey }: { titleKey: MessageKey }) {
  const { t } = useT();
  const options = useStackOptions();

  return (
    <Stack screenOptions={options}>
      <Stack.Screen
        name="index"
        options={{
          title: t(titleKey),
          headerLargeTitle: true,
          headerRight: () => <AccountButton />,
        }}
      />
    </Stack>
  );
}
