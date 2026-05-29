import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
    VITE_MARKETING_URL: z.url().optional(),
    VITE_ERP_URL: z.url().optional(),
    VITE_STAFF_URL: z.url().optional(),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
