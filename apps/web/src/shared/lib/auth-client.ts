import { env } from "@orrn/env/web";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient, magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    twoFactorClient(),
    magicLinkClient()
  ]
});
