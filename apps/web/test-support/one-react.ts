/**
 * Test-only: the workspace has two React copies (19.2.0 under @orrn/ui and @orrn/i18n, 19.2.6 under the web app).
 * The browser build dedupes them; `bun test` does not, and a server render that crosses the two throws "Invalid hook
 * call". This preload makes the 19.2.0 files hand out the web app's 19.2.6 modules, so one React runs. It changes no source.
 */
import { mock } from "bun:test";
import { createRequire } from "node:module";

const web = createRequire(import.meta.url);
const shared = createRequire(new URL("../../../packages/ui/package.json", import.meta.url).pathname);
const ids = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/server", "react-dom/client"];

for (const id of ids) {
  const from = shared.resolve(id);
  const to = web.resolve(id);
  if (from !== to) mock.module(from, () => web(id));
}
