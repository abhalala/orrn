import { Stack } from "@orrn/ui/lib/tg";

export type SkeletonProps = Record<string, any>;

/**
 * Tamagui-based shimmer placeholder.
 */
export function Skeleton(props: SkeletonProps) {
  return (
    <Stack
      backgroundColor="$muted"
      borderRadius={6}
      opacity={0.8}
      animation="lazy"
      enterStyle={{ opacity: 0.6 }}
      {...props}
    />
  );
}
