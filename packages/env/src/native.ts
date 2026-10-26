import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    EXPO_PUBLIC_SERVER_URL: z.url(),
  },
  // Metro (babel-preset-expo) only inlines *literal* `process.env.EXPO_PUBLIC_X`
  // reads. Passing `process.env` as a whole leaves it empty in release builds
  // and `z.url()` then throws at startup (audit N2). Keep every key explicit.
  runtimeEnv: {
    EXPO_PUBLIC_SERVER_URL: process.env.EXPO_PUBLIC_SERVER_URL,
  },
  emptyStringAsUndefined: true,
});
