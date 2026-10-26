import { createEnv, type StandardSchemaV1 } from "@t3-oss/env-core";

/**
 * A URL check written against Standard Schema (what createEnv takes), not zod: this module is
 * in the web entry chunk (trpc and auth clients), and zod there, even zod/mini, cost every
 * first visit to `/` 12 to 18 kB gzip (apps/web/scripts/check-route-budget.ts).
 */
function url<Optional extends boolean = false>(
  optional?: Optional,
): StandardSchemaV1<unknown, Optional extends true ? string | undefined : string> {
  return {
    "~standard": {
      version: 1,
      vendor: "orrn",
      validate(value) {
        if (value === undefined && optional) return { value: undefined as never };
        if (typeof value === "string" && parses(value)) return { value: value as never };
        return { issues: [{ message: optional ? "Invalid URL" : "Required: a valid URL" }] };
      },
    },
  };
}

/** `new URL` rather than `URL.canParse`, which older Android WebViews on the floor lack. */
function parses(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: url(),
    VITE_PUBLIC_URL: url(true),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
