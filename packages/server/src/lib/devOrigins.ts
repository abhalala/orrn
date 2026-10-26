/**
 * Local web dev servers that may call the API with credentials: http://localhost:<port> and
 * http://127.0.0.1:<port> on ANY port, because every git worktree runs its own API/web port pair
 * (see devPorts.ts). Only honoured when the Worker runs with NODE_ENV=development (the deployed dev
 * stage also does; production never does).
 *
 * The match is exact: http, host localhost or 127.0.0.1, a decimal port 1-65535, nothing after it
 * (no path, userinfo or lookalike suffix such as localhost:3201.evil.example).
 */
const DEV_LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):([1-9]\d{0,4})$/;

export function isDevLocalOrigin(env: { NODE_ENV?: string }, origin: string): boolean {
  if (env.NODE_ENV !== "development") return false;
  const match = DEV_LOCAL_ORIGIN.exec(origin);
  return match !== null && Number(match[1]) <= 65535;
}
