/**
 * Local web dev servers that may call the API with credentials. Only honoured when the Worker runs
 * with NODE_ENV=development (the deployed dev stage also does; production never does).
 */
const DEV_LOCAL_ORIGINS = new Set(["http://localhost:3001", "http://localhost:3002"]);

export function isDevLocalOrigin(env: { NODE_ENV?: string }, origin: string): boolean {
  return env.NODE_ENV === "development" && DEV_LOCAL_ORIGINS.has(origin);
}
