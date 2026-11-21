/**
 * Workers observability for the server Worker (delta review SF3, fix brief item 20).
 *
 * Alchemy 0.91.2 turns observability on when the key is left out, and Workers Logs then keep one invocation record
 * per request with the full URL, query string included. orrn puts short-lived signed tickets in the query (raw and page
 * reads, part and upload tickets), and tRPC GET inputs and Better Auth callback links ride there too. So invocation
 * records are off. Console lines stay on: `requestLogger` (lib/requestLog.ts) prints the path without the query, and
 * error lines stay readable in Workers Logs.
 *
 * Read the live setting with `cf workers list` (look for `logs.invocation_logs` on the server Worker).
 */
export const SERVER_OBSERVABILITY = {
  enabled: true,
  logs: { enabled: true, invocationLogs: false },
} as const;
