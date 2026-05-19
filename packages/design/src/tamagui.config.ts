import { defaultConfig } from "@tamagui/config/v4";
import { createTamagui } from "tamagui";

export const tamaguiConfig: ReturnType<typeof createTamagui> = createTamagui(defaultConfig);

export default tamaguiConfig;

export type OrrnTamaguiConfig = typeof tamaguiConfig;

declare module "tamagui" {
  interface TamaguiCustomConfig extends OrrnTamaguiConfig {}
}
