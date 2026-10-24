/** Fixture-backed demo modules. Page agents read this; do not invent a second list. */
export type PreviewModule = {
  slug: string;
  title: string;
  summary: string;
  /** Repo-relative spec path. */
  specPath: string;
  /** Feature-ID prefix, e.g. `FP-DR`. */
  featurePrefix: string;
};

export const PREVIEW_MODULES: readonly PreviewModule[] = [
  {
    slug: "die-room",
    title: "Die room",
    summary: "Section catalogue, die copies, drift readings and tier changes.",
    specPath: "docs/superpowers/specs/2026-10-24-orrn-fp-die-room-design.md",
    featurePrefix: "FP-DR",
  },
  {
    slug: "orders",
    title: "Orders & planning",
    summary: "Sales orders, baki and what the press should run next.",
    specPath: "docs/superpowers/specs/2026-10-24-orrn-fp-orders-planning-design.md",
    featurePrefix: "FP-OP",
  },
  {
    slug: "press",
    title: "Press",
    summary: "Press runs, downtime and what came off the press.",
    specPath: "docs/superpowers/specs/2026-10-24-orrn-fp-press-design.md",
    featurePrefix: "FP-PR",
  },
  {
    slug: "foundry",
    title: "Foundry",
    summary: "Casts, melts, billets and chemistry.",
    specPath: "docs/superpowers/specs/2026-10-24-orrn-fp-foundry-design.md",
    featurePrefix: "FP-FD",
  },
  {
    slug: "ageing",
    title: "Ageing",
    summary: "Ageing batches from the oven to the rack.",
    specPath: "docs/superpowers/specs/2026-10-24-orrn-fp-ageing-design.md",
    featurePrefix: "FP-AG",
  },
  {
    slug: "floor",
    title: "Pack, stock & dispatch",
    summary: "Pack, bundles, stock, packing lists and dispatch.",
    specPath: "docs/superpowers/specs/2026-10-24-orrn-fp-pack-dispatch-design.md",
    featurePrefix: "FP-PK",
  },
  {
    slug: "platform",
    title: "Platform",
    summary: "Customer portal, settings, devices, backups and languages.",
    specPath: "docs/superpowers/specs/2026-10-24-orrn-fp-platform-design.md",
    featurePrefix: "FP-PF",
  },
] as const;

export function previewModule(slug: string): PreviewModule | undefined {
  return PREVIEW_MODULES.find((m) => m.slug === slug);
}
