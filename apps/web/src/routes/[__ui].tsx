import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

/**
 * /__ui: the dev-only component kit. The file is named `[__ui]` because a
 * leading `_` would make it a pathless layout. In production `beforeLoad`
 * 404s and the dead `import.meta.env.DEV` branch drops the dynamic import, so
 * the kit's code is never emitted.
 */
export const Route = createFileRoute("/__ui")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: import.meta.env.DEV ? () => ({ meta: [{ title: "Component kit | orrn" }] }) : undefined,
  component: import.meta.env.DEV ? lazyRouteComponent(() => import("@/features/dev-kit/kit-page")) : () => null,
});
