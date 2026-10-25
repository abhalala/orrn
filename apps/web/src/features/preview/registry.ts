/**
 * Fixture-backed components kept for the paused foundry and ageing lanes. Their routes are
 * redirects to `/preview/coming-soon`; nothing here is in the nav. Do not add new modules.
 */
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
] as const;

export function previewModule(slug: string): PreviewModule | undefined {
  return PREVIEW_MODULES.find((m) => m.slug === slug);
}
