import { Adapt, Select as TgSelect, Sheet, Text, YStack } from "@orrn/ui/lib/tg";

export type SelectOption = { label: string; value: string };

export type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
};

/**
 * Cross-platform Tamagui select. Web renders a popover; native renders a
 * Sheet via Tamagui Adapt.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  width = 200,
}: SelectProps) {
  return (
    <TgSelect value={value} onValueChange={onValueChange} disablePreventBodyScroll>
      <TgSelect.Trigger
        width={width}
        height={36}
        borderRadius={8}
        borderWidth={1}
        borderColor="$borderColor"
        backgroundColor="$backgroundStrong"
        paddingHorizontal={12}
        disabled={disabled}
      >
        <TgSelect.Value placeholder={placeholder} />
      </TgSelect.Trigger>

      <Adapt when="maxMd" platform="touch">
        <Sheet modal dismissOnSnapToBottom snapPointsMode="fit">
          <Sheet.Frame padding={12}>
            <Adapt.Contents />
          </Sheet.Frame>
          <Sheet.Overlay backgroundColor="rgba(15,23,42,0.4)" />
        </Sheet>
      </Adapt>

      <TgSelect.Content zIndex={200000}>
        <TgSelect.Viewport
          minWidth={200}
          backgroundColor="$backgroundStrong"
          borderRadius={8}
          borderWidth={1}
          borderColor="$borderColor"
        >
          <TgSelect.Group>
            <YStack padding={4}>
              {options.map((opt, index) => (
                <TgSelect.Item
                  index={index}
                  key={opt.value}
                  value={opt.value}
                  paddingHorizontal={10}
                  paddingVertical={8}
                  borderRadius={6}
                  hoverStyle={{ backgroundColor: "$backgroundHover" }}
                >
                  <TgSelect.ItemText>
                    <Text fontSize={13}>{opt.label}</Text>
                  </TgSelect.ItemText>
                </TgSelect.Item>
              ))}
            </YStack>
          </TgSelect.Group>
        </TgSelect.Viewport>
      </TgSelect.Content>
    </TgSelect>
  );
}
