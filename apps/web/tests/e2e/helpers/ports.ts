import { resolveDevPorts } from "@orrn/server/lib/devPorts";

/**
 * The API / web URLs of THIS worktree's stack (E2E_API_PORT, E2E_WEB_PORT, or their URL twins;
 * today's 3000 / 3002 when none is set). Same resolver as playwright.config.ts, so the servers that
 * were started and the URLs the tests call cannot disagree. Never hard-code a port in a spec.
 */
const ports = resolveDevPorts(process.env);

/** API origin, e.g. http://localhost:3200 */
export const API_URL = ports.apiURL;
/** Web origin, e.g. http://localhost:3201 */
export const WEB_ORIGIN = ports.webURL;
/** Web host as the browser sees it (what the app sends as `companyHost`), e.g. localhost:3201 */
export const WEB_HOST = new URL(ports.webURL).host;
