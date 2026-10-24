import { Card, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { PageHeader } from "@orrn/ui/components/page-header";
import { createFileRoute, Link } from "@tanstack/react-router";

import { PREVIEW_MODULES } from "@/features/preview/registry";
import type { FileRouteTypes } from "@/routeTree.gen";

const MODULE_TO = {
  "die-room": "/preview/die-room",
  orders: "/preview/orders",
  press: "/preview/press",
  foundry: "/preview/foundry",
  ageing: "/preview/ageing",
  floor: "/preview/floor",
  platform: "/preview/platform",
} as const satisfies Record<string, FileRouteTypes["to"]>;

type GallerySlug = keyof typeof MODULE_TO;

function isGallerySlug(slug: string): slug is GallerySlug {
  return Object.hasOwn(MODULE_TO, slug);
}

export const Route = createFileRoute("/_tenant/preview/")({
  component: PreviewGallery,
});

function PreviewGallery() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p
        role="status"
        className="m-0 rounded-card border border-border bg-surface-sunken px-3 py-2 text-[13px] font-medium leading-5 text-muted-foreground"
      >
        Preview · sample data · nothing is saved
      </p>
      <PageHeader
        title="Preview"
        subtitle="Sample screens for the plant modules. Nothing here is saved."
      />
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
        {PREVIEW_MODULES.map((mod) => {
          const to = isGallerySlug(mod.slug) ? MODULE_TO[mod.slug] : "/preview";
          return (
            <li key={mod.slug} className="min-w-0">
              <Card className="relative h-full transition-[border-color] duration-[var(--dur-fast)] hover:border-control/60">
                <CardHeader>
                  <CardTitle>
                    <Link
                      to={to}
                      className="text-foreground no-underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none"
                    >
                      {mod.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>{mod.summary}</CardDescription>
                </CardHeader>
                <p className="m-0 font-mono text-[12px] text-muted-foreground">{mod.featurePrefix}</p>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
