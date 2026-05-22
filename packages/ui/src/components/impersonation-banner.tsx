import { Paragraph, Stack, Text, XStack } from "@orrn/ui/lib/tg";

import { Button } from "./button";

export type ImpersonationBannerProps = {
  companyName?: string | null;
  onStop: () => void;
  stopLabel?: string;
};

/**
 * Shared sticky red banner used on both web and native any time the request
 * context shows we're inside an impersonation session.
 */
export function ImpersonationBanner({
  companyName,
  onStop,
  stopLabel = "Stop",
}: ImpersonationBannerProps) {
  return (
    <Stack
      width="100%"
      backgroundColor="#dc2626"
      paddingHorizontal={16}
      paddingVertical={10}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      gap={12}
    >
      <XStack alignItems="center" gap={8} flex={1} flexWrap="wrap">
        <Text
          color="#ffffff"
          fontWeight="700"
          fontSize={12}
          textTransform="uppercase"
          letterSpacing={0.6}
        >
          Impersonating
        </Text>
        <Paragraph color="#ffffff" fontSize={13} margin={0}>
          {companyName ?? "tenant"} — every action is audited.
        </Paragraph>
      </XStack>
      <Button
        variant="outline"
        size="sm"
        onPress={onStop}
        backgroundColor="#ffffff"
        borderColor="#ffffff"
        hoverStyle={{ backgroundColor: "#fee2e2", borderColor: "#fee2e2" }}
        pressStyle={{ backgroundColor: "#fee2e2", borderColor: "#fee2e2" }}
      >
        <Text color="#b91c1c" fontWeight="600" fontSize={12}>
          {stopLabel}
        </Text>
      </Button>
    </Stack>
  );
}
