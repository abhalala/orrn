/**
 * The web Worker's script (orrn.in / dev.orrn.app), deployed by alchemy.run.ts in front of the
 * static assets (`run_worker_first`). Edge rules:
 * 1. Plain-HTTP requests get a permanent redirect to HTTPS (browsers showed "Not secure" for
 *    http://orrn.in because nothing upgraded the request).
 * 2. "www." hosts redirect to the apex host.
 * 3. Unknown HTML routes fall back to the SPA shell.
 * 4. `/.well-known/*` (the passkey domain association the web build writes, plan 2026-11-18 Task 6):
 *    `apple-app-site-association` and `*.json` are served as `application/json` (the first has no
 *    extension, which the asset host types as "application/null", and Apple only reads it as JSON);
 *    any other well-known file keeps its own type. A well-known file that was
 *    not built is a 404, never the SPA shell (the asset host's own not-found handling serves the
 *    shell with a 200, which Apple and Android would read as a broken association).
 * 5. Every HTTPS response carries HSTS so browsers stop trying HTTP at all. No
 *    includeSubDomains/preload: tenant and print-station hosts decide for themselves.
 *
 * A string because Alchemy writes it out as the Worker's entry file. Tested by importing it in
 * packages/server/test/passkey-association.test.ts.
 */
export const WEB_EDGE_SCRIPT = `
const HSTS = "max-age=31536000";
const WELL_KNOWN = "/.well-known/";

function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function wellKnown(request, env) {
  const response = await env.ASSETS.fetch(request);
  const type = response.headers.get("content-type") ?? "";
  if (response.status === 404 || type.includes("text/html")) {
    return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  // A 304 (revalidation of a file that exists) and anything else that is not the file pass untouched.
  if (response.status !== 200) return response;
  const path = new URL(request.url).pathname;
  return path === "/.well-known/apple-app-site-association" || path.endsWith(".json")
    ? withHeaders(response, { "content-type": "application/json" })
    : response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const redirectStatus = request.method === "GET" || request.method === "HEAD" ? 301 : 308;

    if (!isLocal && url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), redirectStatus);
    }
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), redirectStatus);
    }

    let response;
    if (url.pathname.startsWith(WELL_KNOWN)) {
      response = await wellKnown(request, env);
    } else {
      response = await env.ASSETS.fetch(request);
      if (response.status === 404 && request.method === "GET") {
        const accept = request.headers.get("accept") ?? "";
        if (accept.includes("text/html")) {
          response = await env.ASSETS.fetch(new Request(new URL("/", url), request));
        }
      }
    }
    return isLocal ? response : withHeaders(response, { "Strict-Transport-Security": HSTS });
  },
};
`;
