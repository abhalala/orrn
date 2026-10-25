declare const __ORRN_WEB_VERSION__: string | undefined;
declare const __ORRN_BUILD_DATE__: string | undefined;

/** Version and build day of this web build (`define` in vite.config.ts); "dev" outside a Vite build (tests). */
export const WEB_BUILD = {
  version: typeof __ORRN_WEB_VERSION__ === "string" ? __ORRN_WEB_VERSION__ : "dev",
  date: typeof __ORRN_BUILD_DATE__ === "string" ? __ORRN_BUILD_DATE__ : "dev",
} as const;
